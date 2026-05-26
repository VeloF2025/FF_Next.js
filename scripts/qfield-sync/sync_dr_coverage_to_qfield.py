#!/usr/bin/env python3
"""
Sync DR Coverage layers from FibreFlow (Neon) to QFieldCloud.

Creates 4 layers per project inside an "OES Coverage" group:

  ┌─ OES Coverage (group) ──────────────────────────────────────────┐
  │  Activated DRs          — red dots (planned coords)             │
  │  Activated Coverage 15m — red 7.5m geographic circles           │
  │  Remaining DRs          — orange dots (planned coords)          │
  │  Remaining Coverage 15m — orange 7.5m geographic circles        │
  └─────────────────────────────────────────────────────────────────┘

For umbrella projects (multiple FF projects linked), one GPKG per
sub-project is uploaded (avoiding the 100 MB nginx upload limit).
Each sub-project gets its own subgroup in the OES Coverage group.

Circles are true 7.5-metre-radius polygons on the ground (UTM Zone 35S
buffering, reprojected to WGS84).

Usage:
    python3 sync_dr_coverage_to_qfield.py
    python3 sync_dr_coverage_to_qfield.py --dry-run

Author: Hein / Claude Code
Date: 2026-04-13
"""

import os
import re
import sys
import shutil
import sqlite3
import struct
import logging
import time
import argparse
import uuid
import copy
import xml.etree.ElementTree as ET
from typing import List, Tuple, Optional, Dict

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/qfield-oes-sync.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

NEON_DATABASE_URL = os.environ.get('NEON_DATABASE_URL', '')
QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME', 'admin')
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD', 'VF-qfield-2026!')
QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')
QFIELD_FALLBACK_PROJECT_ID = os.environ.get('QFIELD_PROJECT_ID', 'e849b878-f8a8-4f84-a3f1-9fbd051686c0')

OUTPUT_DIR = '/tmp/qfield_dr_coverage_sync'
GPKG_FILENAME = 'dr_coverage.gpkg'

BUFFER_DISTANCE_M = 7.5    # 7.5 m radius = 15 m diameter coverage (labelled "15m")
BUFFER_SEGMENTS   = 8      # 8 pts/quadrant = 32-vertex polygon (keeps file under 100MB)
SRC_CRS = 'EPSG:4326'
UTM_CRS = 'EPSG:32735'     # UTM Zone 35S — metre-accurate for SA

SA_BOUNDS = {'min_lat': -35.0, 'max_lat': -22.0, 'min_lon': 16.0, 'max_lon': 33.0}

# Stale layer names from previous runs to remove
STALE_NAMES = {
    'DR Coverage 25m',
    'Activated DRs', 'Activated Coverage 25m',
    'Remaining DRs', 'Remaining Coverage 25m',
}

# Layer order: circles first (drawn under), dots on top
LAYER_CONFIG = [
    # (table, display_name, geom_type, fill_color, outline_color, dot_size_mm)
    ('dr_remaining_15m', 'Remaining Coverage 15m', 'Polygon', '255,140,0,50',  '255,140,0,200', None),
    ('dr_remaining',     'Remaining DRs',          'Point',   '255,140,0,230', None,            '2.5'),
    ('dr_activated_15m', 'Activated Coverage 15m',  'Polygon', '220,50,50,50',  '220,50,50,200', None),
    ('dr_activated',     'Activated DRs',           'Point',   '220,50,50,230', None,            '2.5'),
]


def slugify(name: str) -> str:
    """Convert a project name to a safe filename slug (max 20 chars)."""
    s = re.sub(r'[^a-zA-Z0-9]+', '_', name).strip('_').lower()
    return s[:20]


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def is_valid_sa(lat: float, lon: float) -> bool:
    return (SA_BOUNDS['min_lat'] <= lat <= SA_BOUNDS['max_lat'] and
            SA_BOUNDS['min_lon'] <= lon <= SA_BOUNDS['max_lon'])


def gpkg_point(lon: float, lat: float) -> bytes:
    header = b'GP' + struct.pack('<B', 0) + struct.pack('<B', 1) + struct.pack('<i', 4326)
    wkb = struct.pack('<B', 1) + struct.pack('<I', 1) + struct.pack('<dd', lon, lat)
    return header + wkb


def gpkg_polygon(coords: List[Tuple[float, float]]) -> bytes:
    header = b'GP' + struct.pack('<B', 0) + struct.pack('<B', 1) + struct.pack('<i', 4326)
    ring = coords if coords[0] == coords[-1] else coords + [coords[0]]
    wkb = (struct.pack('<B', 1) + struct.pack('<I', 3) +
           struct.pack('<I', 1) + struct.pack('<I', len(ring)))
    for lon, lat in ring:
        wkb += struct.pack('<dd', lon, lat)
    return header + wkb


def compute_buffers(points: List[Tuple]) -> List[Tuple]:
    """
    (drop_number, lat, lon) → (drop_number, [(lon,lat),...]) WGS84 ring.
    Uses UTM Zone 35S for accurate metre-based buffering.
    """
    from shapely.geometry import Point
    from pyproj import Transformer
    to_utm = Transformer.from_crs(SRC_CRS, UTM_CRS, always_xy=True)
    to_wgs = Transformer.from_crs(UTM_CRS, SRC_CRS, always_xy=True)
    results = []
    errors = 0
    for dn, lat, lon in points:
        try:
            x, y = to_utm.transform(lon, lat)
            circle = Point(x, y).buffer(BUFFER_DISTANCE_M, resolution=BUFFER_SEGMENTS)
            coords = [to_wgs.transform(cx, cy) for cx, cy in circle.exterior.coords]
            results.append((dn, coords))
        except Exception as exc:
            logger.warning(f'Buffer error {dn}: {exc}')
            errors += 1
    if errors:
        logger.warning(f'{errors} buffer errors')
    return results


# ---------------------------------------------------------------------------
# Database: sync targets
# ---------------------------------------------------------------------------

def fetch_sync_targets() -> List[Dict]:
    import psycopg2
    try:
        conn = psycopg2.connect(NEON_DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            SELECT qp.qfield_project_id, qp.name,
                   ARRAY_AGG(qpl.fibreflow_project_id::text
                             ORDER BY qpl.fibreflow_project_id::text) AS ff_project_ids,
                   ARRAY_AGG(p.project_name
                             ORDER BY qpl.fibreflow_project_id::text) AS ff_project_names
            FROM qfield_projects qp
            INNER JOIN qfield_project_links qpl ON qpl.qfield_project_id = qp.id
            INNER JOIN projects p ON p.id = qpl.fibreflow_project_id
            WHERE qp.is_active = true AND qp.sync_enabled = true
            GROUP BY qp.qfield_project_id, qp.name, qp.is_default
            ORDER BY qp.is_default DESC, qp.name
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        if rows:
            targets = [{'qfield_project_id': r[0], 'qfield_name': r[1],
                        'ff_project_ids': r[2], 'ff_project_names': r[3]} for r in rows]
            logger.info(f'Found {len(targets)} sync targets')
            for t in targets:
                logger.info(f'  {t["qfield_name"]} → {len(t["ff_project_ids"])} FF project(s)')
            return targets
    except Exception as exc:
        logger.warning(f'Could not query qfield_projects: {exc}')
    return [{'qfield_project_id': QFIELD_FALLBACK_PROJECT_ID,
             'qfield_name': 'Fallback', 'ff_project_ids': [], 'ff_project_names': []}]


# ---------------------------------------------------------------------------
# Database: DR data by FF project
# ---------------------------------------------------------------------------

def fetch_data_by_project() -> Dict[str, Dict]:
    """
    Returns {ff_project_id: {
        'activated':    [(drop_number, lat, lon), ...],
        'remaining':    [(drop_number, lat, lon), ...],
    }}
    """
    import psycopg2
    logger.info('Connecting to Neon database...')
    conn = psycopg2.connect(NEON_DATABASE_URL)
    cur = conn.cursor()
    result: Dict[str, Dict] = {}

    def bucket(pid):
        if pid not in result:
            result[pid] = {'activated': [], 'remaining': []}
        return result[pid]

    # Activated dots — planned coords
    logger.info('Fetching activated DRs...')
    cur.execute("""
        SELECT d.project_id::text, d.drop_number,
               d.latitude::float, d.longitude::float
        FROM drops d
        INNER JOIN oes_activations oa ON d.drop_number = oa.drop_number
        WHERE d.latitude IS NOT NULL AND d.longitude IS NOT NULL
          AND d.latitude::float != 0 AND d.longitude::float != 0
        ORDER BY d.project_id, d.drop_number
    """)
    for pid, dn, lat, lon in cur.fetchall():
        if is_valid_sa(lat, lon):
            bucket(pid)['activated'].append((dn, lat, lon))
    logger.info(f'  {sum(len(v["activated"]) for v in result.values())} activated DRs')

    # Remaining DRs — planned coords
    logger.info('Fetching remaining DRs...')
    cur.execute("""
        SELECT d.project_id::text, d.drop_number,
               d.latitude::float, d.longitude::float
        FROM drops d
        LEFT JOIN oes_activations oa ON d.drop_number = oa.drop_number
        WHERE oa.drop_number IS NULL
          AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL
          AND d.latitude::float != 0 AND d.longitude::float != 0
        ORDER BY d.project_id, d.drop_number
    """)
    for pid, dn, lat, lon in cur.fetchall():
        if is_valid_sa(lat, lon):
            bucket(pid)['remaining'].append((dn, lat, lon))
    logger.info(f'  {sum(len(v["remaining"]) for v in result.values())} remaining DRs')

    cur.close()
    conn.close()
    return result


# ---------------------------------------------------------------------------
# GeoPackage — 4 tables: 2 point + 2 polygon
# ---------------------------------------------------------------------------

def create_gpkg(data: Dict, project_dir: str, filename: str = GPKG_FILENAME) -> str:
    gpkg_path = os.path.join(project_dir, filename)
    if os.path.exists(gpkg_path):
        os.remove(gpkg_path)

    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()

    cur.execute("""CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT,
        organization_coordsys_id INTEGER, definition TEXT, description TEXT)""")
    cur.execute("""INSERT INTO gpkg_spatial_ref_sys VALUES
        ('WGS 84',4326,'EPSG',4326,
         'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],
          PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]','WGS 84')""")
    cur.execute("""CREATE TABLE gpkg_contents (
        table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT,
        description TEXT, last_change TEXT,
        min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER)""")
    cur.execute("""CREATE TABLE gpkg_geometry_columns (
        table_name TEXT, column_name TEXT, geometry_type_name TEXT,
        srs_id INTEGER, z INTEGER, m INTEGER)""")

    def add_point_table(table, desc, rows):
        cur.execute(f"""CREATE TABLE "{table}" (
            fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB,
            drop_number TEXT, lat REAL, lon REAL)""")
        cur.execute(f"INSERT INTO gpkg_contents VALUES ('{table}','features','{table}','{desc}','',NULL,NULL,NULL,NULL,4326)")
        cur.execute(f"INSERT INTO gpkg_geometry_columns VALUES ('{table}','geom','POINT',4326,0,0)")
        for dn, lat, lon in rows:
            cur.execute(f'INSERT INTO "{table}" (geom,drop_number,lat,lon) VALUES (?,?,?,?)',
                        (gpkg_point(lon, lat), dn, lat, lon))

    def add_polygon_table(table, desc, rows):
        cur.execute(f"""CREATE TABLE "{table}" (
            fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB,
            drop_number TEXT)""")
        cur.execute(f"INSERT INTO gpkg_contents VALUES ('{table}','features','{table}','{desc}','',NULL,NULL,NULL,NULL,4326)")
        cur.execute(f"INSERT INTO gpkg_geometry_columns VALUES ('{table}','geom','POLYGON',4326,0,0)")
        for dn, coords in rows:
            cur.execute(f'INSERT INTO "{table}" (geom,drop_number) VALUES (?,?)',
                        (gpkg_polygon(coords), dn))

    # 1. Activated dots
    add_point_table('dr_activated', 'Activated DRs', data['activated'])
    logger.info(f'  dr_activated:      {len(data["activated"])} points')

    # 2. Activated 7.5m-radius circles (same planned coords as dot)
    act_buffers = compute_buffers(data['activated'])
    add_polygon_table('dr_activated_15m', 'Activated Coverage 15m', act_buffers)
    logger.info(f'  dr_activated_15m:  {len(act_buffers)} circles')

    # 3. Remaining dots
    add_point_table('dr_remaining', 'Remaining DRs', data['remaining'])
    logger.info(f'  dr_remaining:      {len(data["remaining"])} points')

    # 4. Remaining 7.5m-radius circles (same planned coords as dot)
    rem_buffers = compute_buffers(data['remaining'])
    add_polygon_table('dr_remaining_15m', 'Remaining Coverage 15m', rem_buffers)
    logger.info(f'  dr_remaining_15m:  {len(rem_buffers)} circles')

    conn.commit()
    conn.close()
    return gpkg_path


# ---------------------------------------------------------------------------
# QGS renderers
# ---------------------------------------------------------------------------

def set_point_renderer(maplayer: ET.Element, color: str, size_mm: str = '2.5') -> None:
    for el in list(maplayer):
        if el.tag == 'renderer-v2':
            maplayer.remove(el)
    r = ET.SubElement(maplayer, 'renderer-v2')
    r.set('type', 'singleSymbol')
    r.set('symbollevels', '0')
    r.set('enableorderby', '0')
    syms = ET.SubElement(r, 'symbols')
    sym = ET.SubElement(syms, 'symbol')
    sym.set('type', 'marker')
    sym.set('name', '0')
    sym.set('alpha', '1')
    lyr = ET.SubElement(sym, 'layer')
    lyr.set('class', 'SimpleMarker')
    lyr.set('pass', '0')
    lyr.set('enabled', '1')
    lyr.set('locked', '0')
    opts = ET.SubElement(lyr, 'Option')
    opts.set('type', 'Map')
    for name, value in [
        ('color',              color),
        ('outline_color',      '255,255,255,180'),
        ('outline_width',      '0.2'),
        ('outline_width_unit', 'MM'),
        ('name',               'circle'),
        ('size',               size_mm),
        ('size_unit',          'MM'),
    ]:
        o = ET.SubElement(opts, 'Option')
        o.set('type', 'QString')
        o.set('name', name)
        o.set('value', value)


def set_polygon_renderer(maplayer: ET.Element, fill_color: str,
                         outline_color: str) -> None:
    for el in list(maplayer):
        if el.tag == 'renderer-v2':
            maplayer.remove(el)
    r = ET.SubElement(maplayer, 'renderer-v2')
    r.set('type', 'singleSymbol')
    r.set('symbollevels', '0')
    r.set('enableorderby', '0')
    syms = ET.SubElement(r, 'symbols')
    sym = ET.SubElement(syms, 'symbol')
    sym.set('type', 'fill')
    sym.set('name', '0')
    sym.set('alpha', '1')
    lyr = ET.SubElement(sym, 'layer')
    lyr.set('class', 'SimpleFill')
    lyr.set('pass', '0')
    lyr.set('enabled', '1')
    opts = ET.SubElement(lyr, 'Option')
    opts.set('type', 'Map')
    for name, value in [
        ('color',               fill_color),
        ('outline_color',       outline_color),
        ('outline_width',       '0.4'),
        ('outline_width_unit',  'MM'),
        ('style',               'solid'),
        ('outline_style',       'solid'),
    ]:
        o = ET.SubElement(opts, 'Option')
        o.set('type', 'QString')
        o.set('name', name)
        o.set('value', value)


def add_label(maplayer: ET.Element) -> None:
    for el in list(maplayer):
        if el.tag == 'labeling':
            maplayer.remove(el)
    lab = ET.SubElement(maplayer, 'labeling')
    lab.set('type', 'simple')
    settings = ET.SubElement(lab, 'settings')
    settings.set('calloutType', 'simple')
    ts = ET.SubElement(settings, 'text-style')
    ts.set('fieldName', 'drop_number')
    ts.set('isExpression', '0')
    ts.set('fontSize', '7')
    ts.set('fontSizeUnit', 'Point')
    ts.set('textColor', '30,30,30,255')
    pl = ET.SubElement(settings, 'placement')
    pl.set('placement', '0')
    pl.set('quadOffset', '4')
    pl.set('dist', '0')
    ren = ET.SubElement(settings, 'rendering')
    ren.set('scaleVisibility', '0')
    ren.set('displayAll', '0')


# ---------------------------------------------------------------------------
# QGS helpers
# ---------------------------------------------------------------------------

def create_minimal_qgs(project_dir: str, qgs_name: str) -> str:
    """Create a bare-minimum valid QGS when a project has no existing file."""
    qgs_path = os.path.join(project_dir, qgs_name)
    root = ET.Element('qgis')
    root.set('version', '3.28.0')
    root.set('projectname', qgs_name.replace('_cloud.qgs', '').replace('.qgs', ''))
    crs_el = ET.SubElement(root, 'projectCrs')
    srs = ET.SubElement(crs_el, 'spatialrefsys')
    for tag, val in [
        ('wkt', 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'),
        ('proj4', '+proj=longlat +datum=WGS84 +no_defs'),
        ('srsid', '3452'), ('srid', '4326'), ('authid', 'EPSG:4326'),
        ('description', 'WGS 84'), ('projectionacronym', 'longlat'),
        ('ellipsoidacronym', 'EPSG:7030'), ('geographicflag', 'true'),
    ]:
        ET.SubElement(srs, tag).text = val
    # Pre-set canvas extent to SA coverage area so QGIS thumbnail renders fast
    # (without this, QGIS computes extent from all features → 30-min timeout)
    canvas = ET.SubElement(root, 'mapcanvas')
    canvas.set('name', 'theMapCanvas')
    canvas.set('annotationsVisible', '1')
    extent = ET.SubElement(canvas, 'extent')
    for tag, val in [('xmin', '26.0'), ('ymin', '-26.5'),
                     ('xmax', '29.0'), ('ymax', '-25.5')]:
        ET.SubElement(extent, tag).text = val
    canvas_crs = ET.SubElement(canvas, 'destinationsrs')
    canvas_srs = ET.SubElement(canvas_crs, 'spatialrefsys')
    ET.SubElement(canvas_srs, 'authid').text = 'EPSG:4326'
    ET.SubElement(root, 'projectlayers')
    ltg = ET.SubElement(root, 'layer-tree-group')
    ltg.set('name', '')
    ltg.set('checked', 'Qt::Checked')
    ltg.set('expanded', '1')
    ET.ElementTree(root).write(qgs_path, encoding='UTF-8', xml_declaration=True)
    logger.info(f'  Created minimal QGS: {qgs_name}')
    return qgs_path


def _inject_layers(parent_group: ET.Element, projectlayers: ET.Element,
                   gpkg_filename: str, tmpl_point, tmpl_poly) -> None:
    """Append 4 coverage layers (2 point + 2 polygon) into parent_group."""
    for table, display_name, geom_type, fill_color, outline_color, dot_size in LAYER_CONFIG:
        datasource = f'./{gpkg_filename}|layername={table}'
        layer_id = f'{table}_{str(uuid.uuid4()).replace("-", "_")}'

        ltl = ET.Element('layer-tree-layer')
        ltl.set('id', layer_id)
        ltl.set('name', display_name)
        ltl.set('source', datasource)
        ltl.set('providerKey', 'ogr')
        ltl.set('checked', 'Qt::Checked')
        ltl.set('expanded', '1')
        parent_group.append(ltl)

        template = tmpl_point if geom_type == 'Point' else tmpl_poly
        if template is not None:
            maplayer = copy.deepcopy(template)
            maplayer.set('id', layer_id)
            maplayer.set('geometry', geom_type)
            for tag, val in [('id', layer_id), ('datasource', datasource),
                              ('layername', display_name)]:
                el = maplayer.find(tag)
                if el is not None:
                    el.text = val
            projectlayers.append(maplayer)
        else:
            maplayer = ET.SubElement(projectlayers, 'maplayer')
            maplayer.set('id', layer_id)
            maplayer.set('geometry', geom_type)
            maplayer.set('type', 'vector')
            ET.SubElement(maplayer, 'id').text = layer_id
            ET.SubElement(maplayer, 'datasource').text = datasource
            ET.SubElement(maplayer, 'layername').text = display_name
            ET.SubElement(maplayer, 'provider').text = 'ogr'

        if geom_type == 'Point':
            set_point_renderer(maplayer, fill_color, dot_size or '2.5')
            add_label(maplayer)
        else:
            set_polygon_renderer(maplayer, fill_color, outline_color)


# ---------------------------------------------------------------------------
# QGS update
# ---------------------------------------------------------------------------

def update_qgs(client, qf_pid: str, qf_name: str, project_dir: str,
               inject_coverage: bool = True,
               gpkg_map: Optional[Dict[str, str]] = None) -> Optional[str]:
    """
    Download (or create) the QGS, clean stale layers, inject coverage layers.

    gpkg_map: None              → single dr_coverage.gpkg (single-project mode)
              {area: filename}  → one GPKG per area (umbrella/split mode)
    """
    from qfieldcloud_sdk import sdk

    files = client.list_remote_files(qf_pid)
    client.download_files(
        files=files, project_id=qf_pid,
        download_type=sdk.FileTransferType.PROJECT,
        local_dir=project_dir, filter_glob='*.qgs'
    )

    qgs_path = next((os.path.join(project_dir, f) for f in os.listdir(project_dir)
                     if f.endswith('.qgs')), None)
    if not qgs_path:
        # New project — create a minimal QGS
        qgs_path = create_minimal_qgs(project_dir, f'{slugify(qf_name)}_cloud.qgs')

    logger.info(f'  Updating {os.path.basename(qgs_path)}')
    tree = ET.parse(qgs_path)
    root = tree.getroot()
    layer_tree = root.find('.//layer-tree-group')
    projectlayers = root.find('.//projectlayers')

    # Remove old OES Coverage group from tree
    for group in list(layer_tree.findall('layer-tree-group')):
        if group.get('name') == 'OES Coverage':
            layer_tree.remove(group)

    # Remove stale GeoJSON maplayers (old sync format)
    geojson_ids: set = set()
    for ml in list(projectlayers.findall('maplayer')):
        ds = ml.find('datasource')
        if ds is not None and ds.text and '.geojson' in ds.text.lower():
            lid = ml.find('id')
            if lid is not None and lid.text:
                geojson_ids.add(lid.text)
            projectlayers.remove(ml)
            ln = ml.find('layername')
            logger.info(f'  Removed stale GeoJSON layer: {ln.text if ln is not None else "?"}')

    def prune_tree(group_el):
        for child in list(group_el):
            if child.tag == 'layer-tree-layer' and child.get('id') in geojson_ids:
                group_el.remove(child)
            elif child.tag == 'layer-tree-group':
                prune_tree(child)
    if geojson_ids:
        prune_tree(layer_tree)

    # Remove all stale coverage maplayers (by name or datasource)
    all_stale = STALE_NAMES | {cfg[1] for cfg in LAYER_CONFIG}
    for ml in list(projectlayers.findall('maplayer')):
        ln = ml.find('layername')
        ds = ml.find('datasource')
        if (ln is not None and ln.text in all_stale) or \
           (ds is not None and ds.text and 'dr_coverage' in ds.text):
            projectlayers.remove(ml)

    if inject_coverage:
        # Fresh OES Coverage group — insert after OES Report if present
        cov_group = ET.Element('layer-tree-group')
        cov_group.set('name', 'OES Coverage')
        cov_group.set('checked', 'Qt::Checked')
        cov_group.set('expanded', '1')
        insert_pos = 0
        for i, child in enumerate(layer_tree):
            if child.get('name') == 'OES Report':
                insert_pos = i + 1
                break
        layer_tree.insert(insert_pos, cov_group)

        # Template layers for cloning (may be None for new projects)
        tmpl_point = next((ml for ml in projectlayers.findall('maplayer')
                           if ml.get('geometry') == 'Point'
                           and ml.find('extent') is not None), None)
        tmpl_poly = next((ml for ml in projectlayers.findall('maplayer')
                          if ml.get('geometry') in ('Polygon', 'MultiPolygon')
                          and ml.find('extent') is not None), None)

        if gpkg_map:
            # Split mode: one collapsed subgroup per area
            for area_name, gpkg_filename in gpkg_map.items():
                area_group = ET.SubElement(cov_group, 'layer-tree-group')
                area_group.set('name', area_name)
                area_group.set('checked', 'Qt::Checked')
                area_group.set('expanded', '0')
                _inject_layers(area_group, projectlayers, gpkg_filename,
                               tmpl_point, tmpl_poly)
        else:
            # Single GPKG mode
            _inject_layers(cov_group, projectlayers, GPKG_FILENAME,
                           tmpl_point, tmpl_poly)
    else:
        logger.warning('  GPKG upload failed — skipping coverage layer injection (stale layers removed only)')

    tree.write(qgs_path, encoding='UTF-8', xml_declaration=True)
    return qgs_path


# ---------------------------------------------------------------------------
# Push to one project
# ---------------------------------------------------------------------------

def push_to_project(qf_pid: str, qf_name: str, merged: Dict, dry_run: bool,
                    split_data: Optional[Dict[str, Dict]] = None,
                    ff_names: Optional[Dict[str, str]] = None) -> bool:
    """
    split_data: {ff_project_id: data_dict}  — when set, upload one GPKG per area
    ff_names:   {ff_project_id: project_name} — used to name per-area GPKGs
    """
    from qfieldcloud_sdk import sdk

    project_dir = os.path.join(OUTPUT_DIR, qf_pid.replace('-', '_'))
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir)
    os.makedirs(project_dir, exist_ok=True)

    use_split = bool(split_data and ff_names and len(split_data) > 1)

    if use_split:
        # Build per-area GPKGs (skip empty areas)
        gpkg_plan: Dict[str, str] = {}  # {area_name: filename}
        for ff_pid, ff_name in ff_names.items():
            data = split_data.get(ff_pid, {})
            if not data.get('activated') and not data.get('remaining'):
                continue
            slug = slugify(ff_name)
            filename = f'dr_coverage_{slug}.gpkg'
            create_gpkg(data, project_dir, filename)
            gpkg_plan[ff_name] = filename
            logger.info(f'  [{ff_name}] activated={len(data["activated"])} remaining={len(data["remaining"])}')

        if dry_run:
            logger.info(f'  [dry-run] Would push {len(gpkg_plan)} GPKGs to {qf_name}')
            return True

        client = sdk.Client(QFIELD_API_URL)
        client.login(QFIELD_USERNAME, QFIELD_PASSWORD)

        # Upload each GPKG individually
        successful_gpkgs: Dict[str, str] = {}
        for area_name, filename in gpkg_plan.items():
            logger.info(f'  Uploading {filename}...')
            ok = False
            yielded = False
            for r in client.upload_files(project_id=qf_pid,
                                          upload_type=sdk.FileTransferType.PROJECT,
                                          project_path=project_dir,
                                          filter_glob=filename):
                yielded = True
                logger.info(f'    {r.get("name")} → {r.get("status")}')
                if 'SUCCESS' in str(r.get('status', '')):
                    ok = True
            if not yielded:
                # SDK yielded no results → file is already on server and unchanged
                logger.info(f'    {filename} unchanged on server — already up to date')
                ok = True
            if ok:
                successful_gpkgs[area_name] = filename
            else:
                logger.warning(f'  GPKG upload failed for {area_name} — its layers will be skipped')

        inject = bool(successful_gpkgs)
        qgs_path = update_qgs(client, qf_pid, qf_name, project_dir,
                               inject_coverage=inject,
                               gpkg_map=successful_gpkgs if inject else None)

    else:
        # Original single-GPKG mode
        create_gpkg(merged, project_dir)

        if dry_run:
            logger.info(f'  [dry-run] Would push to {qf_name}')
            return True

        client = sdk.Client(QFIELD_API_URL)
        client.login(QFIELD_USERNAME, QFIELD_PASSWORD)

        logger.info(f'  Uploading {GPKG_FILENAME}...')
        gpkg_ok = False
        gpkg_yielded = False
        for r in client.upload_files(project_id=qf_pid,
                                      upload_type=sdk.FileTransferType.PROJECT,
                                      project_path=project_dir,
                                      filter_glob='*.gpkg'):
            gpkg_yielded = True
            logger.info(f'    {r.get("name")} → {r.get("status")}')
            if 'SUCCESS' in str(r.get('status', '')):
                gpkg_ok = True
        if not gpkg_yielded:
            # SDK yielded no results → file already on server and unchanged
            logger.info(f'    {GPKG_FILENAME} unchanged on server — already up to date')
            gpkg_ok = True

        qgs_path = update_qgs(client, qf_pid, qf_name, project_dir,
                               inject_coverage=gpkg_ok)

    if not qgs_path:
        return False

    logger.info(f'  Uploading .qgs...')
    for r in client.upload_files(project_id=qf_pid,
                                  upload_type=sdk.FileTransferType.PROJECT,
                                  project_path=project_dir,
                                  filter_glob='*.qgs'):
        logger.info(f'    {r.get("name")} → {r.get("status")}')

    time.sleep(10)

    logger.info('  Triggering process_projectfile...')
    job1 = client.job_trigger(qf_pid, sdk.JobTypes.PROCESS_PROJECTFILE)
    for _ in range(30):
        time.sleep(2)
        status = client.job_status(job1['id'])
        if status['status'] in ('finished', 'failed'):
            logger.info(f'  process_projectfile: {status["status"]}')
            if status['status'] == 'failed':
                logger.error(status.get('feedback', {}).get('error', '?')[:200])
                return False
            break

    time.sleep(10)

    logger.info('  Triggering package...')
    job2 = client.job_trigger(qf_pid, sdk.JobTypes.PACKAGE)
    for _ in range(60):
        time.sleep(2)
        status = client.job_status(job2['id'])
        if status['status'] in ('finished', 'failed'):
            logger.info(f'  package: {status["status"]}')
            if status['status'] == 'failed':
                logger.error(status.get('feedback', {}).get('error', '?')[:200])
                return False
            break

    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    logger.info('=' * 60)
    logger.info('DR Coverage Sync → QFieldCloud (all projects)')
    logger.info(f'  {BUFFER_DISTANCE_M}m geographic radius | 4 layers per project')
    logger.info(f'  Mode: {"dry-run" if args.dry_run else "live"}')
    logger.info('=' * 60)

    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    sync_targets = fetch_sync_targets()
    data_by_project = fetch_data_by_project()

    success_count = 0
    fail_count = 0

    for target in sync_targets:
        qf_pid = target['qfield_project_id']
        qf_name = target['qfield_name']
        ff_pids = target['ff_project_ids']
        ff_names_list = target.get('ff_project_names') or [None] * len(ff_pids)
        ff_names_map = dict(zip(ff_pids, ff_names_list))

        logger.info('-' * 60)
        logger.info(f'Syncing to {qf_name} ({qf_pid})')

        # Merge all linked FF projects for counts + single-GPKG fallback
        merged: Dict = {'activated': [], 'remaining': []}
        for ff_pid in ff_pids:
            proj = data_by_project.get(ff_pid, {})
            for key in merged:
                merged[key].extend(proj.get(key, []))

        logger.info(f'  Activated: {len(merged["activated"])} | Remaining: {len(merged["remaining"])}')

        if not merged['activated'] and not merged['remaining']:
            logger.info('  Skipping — no data')
            continue

        # Use split mode when multiple FF projects are linked
        use_split = len(ff_pids) > 1
        split_data = {pid: data_by_project.get(pid, {}) for pid in ff_pids} if use_split else None

        try:
            ok = push_to_project(
                qf_pid, qf_name, merged, args.dry_run,
                split_data=split_data,
                ff_names=ff_names_map if use_split else None,
            )
            if ok:
                success_count += 1
                logger.info(f'SUCCESS: {qf_name}')
            else:
                fail_count += 1
                logger.error(f'FAILED: {qf_name}')
        except Exception as exc:
            fail_count += 1
            logger.error(f'FAILED: {qf_name}: {exc}')

    logger.info('=' * 60)
    logger.info(f'DONE: {success_count}/{len(sync_targets)} projects synced')
    logger.info('=' * 60)

    if fail_count > 0 and success_count == 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
