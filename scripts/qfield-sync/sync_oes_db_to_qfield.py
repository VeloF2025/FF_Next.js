#!/usr/bin/env python3
"""
Sync OES activation data from FibreFlow (Neon) to QFieldCloud.

Data is split by FibreFlow project and synced to the correct QField project
via qfield_project_links. FT_Master_Progress gets all projects combined.

Two layers per QField project, written to a single stable-named GPKG ("OES FF.gpkg")
that is overwritten in place every run (no dated files — those rotted the .qgs):
- OES FF Activated (cerise pink) - activated DRs for that project
- OES FF Remaining (orange) - unactivated drops for that project
The report date is stamped into each layer's description, not its name/filename.

Usage:
    python3 sync_oes_db_to_qfield.py [--full] [--report-date YYYY-MM-DD]
"""

import os
import sys
import sqlite3
import struct
import logging
import time
import argparse
import uuid
import copy
import xml.etree.ElementTree as ET
from datetime import datetime
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

# Secrets come from the environment only — no hardcoded defaults in the repo.
# The nightly wrapper (nightly-oes-qfield-sync.sh) exports these from the prod .env;
# for manual runs, export NEON_DATABASE_URL and QFIELD_PASSWORD first.
NEON_DATABASE_URL = os.environ.get('NEON_DATABASE_URL')

QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME', 'admin')  # not a secret
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD')
QFIELD_FALLBACK_PROJECT_ID = os.environ.get('QFIELD_PROJECT_ID', 'af058301-32d1-4bca-84f9-83b899fcbb34')
QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')

OUTPUT_DIR = '/tmp/qfield_oes_sync'

SA_BOUNDS = {
    'min_lat': -35.0,
    'max_lat': -22.0,
    'min_lon': 16.0,
    'max_lon': 33.0
}


def fetch_sync_targets() -> List[Dict]:
    """
    Fetch sync targets: each QField project and its linked FF project IDs.
    Returns list of dicts: {qfield_project_id, qfield_name, ff_project_ids}
    """
    import psycopg2
    try:
        conn = psycopg2.connect(NEON_DATABASE_URL)
        cur = conn.cursor()
        cur.execute("""
            SELECT
                qp.qfield_project_id,
                qp.name,
                ARRAY_AGG(qpl.fibreflow_project_id::text) AS ff_project_ids
            FROM qfield_projects qp
            INNER JOIN qfield_project_links qpl ON qpl.qfield_project_id = qp.id
            WHERE qp.is_active = true
              AND qp.sync_enabled = true
            GROUP BY qp.qfield_project_id, qp.name, qp.is_default
            ORDER BY qp.is_default DESC, qp.name
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        if rows:
            targets = [
                {
                    'qfield_project_id': r[0],
                    'qfield_name': r[1],
                    'ff_project_ids': r[2],
                }
                for r in rows
            ]
            logger.info(f"Found {len(targets)} sync targets from qfield_project_links")
            for t in targets:
                logger.info(f"  {t['qfield_name']} -> {len(t['ff_project_ids'])} FF project(s)")
            return targets
    except Exception as e:
        logger.warning(f"Failed to query sync targets: {e}")

    logger.info(f"Using fallback project ID: {QFIELD_FALLBACK_PROJECT_ID}")
    return [{'qfield_project_id': QFIELD_FALLBACK_PROJECT_ID, 'qfield_name': 'Fallback', 'ff_project_ids': []}]


def is_valid_sa_coordinate(lat: float, lon: float) -> bool:
    return (SA_BOUNDS['min_lat'] <= lat <= SA_BOUNDS['max_lat'] and
            SA_BOUNDS['min_lon'] <= lon <= SA_BOUNDS['max_lon'])


def parse_report_date(date_str: Optional[str]) -> datetime:
    if not date_str:
        return datetime.now()
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        logger.warning(f"Invalid date format '{date_str}', using today")
        return datetime.now()


def create_gpkg_point(lon: float, lat: float) -> bytes:
    header = b'GP'
    header += struct.pack('<B', 0)
    header += struct.pack('<B', 1)
    header += struct.pack('<i', 4326)
    wkb = struct.pack('<B', 1)
    wkb += struct.pack('<I', 1)
    wkb += struct.pack('<d', lon)
    wkb += struct.pack('<d', lat)
    return header + wkb


def add_pole_nr_labeling(maplayer):
    existing_labeling = maplayer.find("labeling")
    if existing_labeling is not None:
        maplayer.remove(existing_labeling)

    labeling = ET.SubElement(maplayer, "labeling")
    labeling.set("type", "simple")

    settings = ET.SubElement(labeling, "settings")
    settings.set("calloutType", "simple")

    text_style = ET.SubElement(settings, "text-style")
    text_style.set("fieldName", "Pole Nr")
    text_style.set("isExpression", "0")
    text_style.set("fontSize", "8")
    text_style.set("fontSizeUnit", "Point")
    text_style.set("fontFamily", "Open Sans")
    text_style.set("fontWeight", "50")
    text_style.set("textColor", "50,50,50,255")
    text_style.set("textOpacity", "1")
    text_style.set("blendMode", "0")
    text_style.set("multilineHeight", "1")

    text_format = ET.SubElement(settings, "text-format")
    text_format.set("wrapChar", "")
    text_format.set("autoWrapLength", "0")
    text_format.set("multilineAlign", "0")
    text_format.set("addDirectionSymbol", "0")
    text_format.set("formatNumbers", "0")

    placement = ET.SubElement(settings, "placement")
    placement.set("placement", "0")
    placement.set("quadOffset", "4")
    placement.set("xOffset", "0")
    placement.set("yOffset", "0")
    placement.set("priority", "5")
    placement.set("dist", "0")
    placement.set("distUnits", "MM")
    placement.set("layerType", "PointGeometry")

    rendering = ET.SubElement(settings, "rendering")
    rendering.set("scaleVisibility", "0")
    rendering.set("scaleMin", "0")
    rendering.set("scaleMax", "0")
    rendering.set("displayAll", "0")
    rendering.set("obstacle", "1")
    rendering.set("obstacleFactor", "1")

    return labeling


def set_renderer(maplayer, color: str = "0,100,255,255"):
    existing_renderer = maplayer.find("renderer-v2")
    if existing_renderer is not None:
        maplayer.remove(existing_renderer)

    renderer = ET.SubElement(maplayer, "renderer-v2")
    renderer.set("type", "singleSymbol")
    renderer.set("symbollevels", "0")
    renderer.set("enableorderby", "0")

    symbols = ET.SubElement(renderer, "symbols")
    symbol = ET.SubElement(symbols, "symbol")
    symbol.set("type", "marker")
    symbol.set("name", "0")
    symbol.set("alpha", "1")
    symbol.set("clip_to_extent", "1")

    layer_el = ET.SubElement(symbol, "layer")
    layer_el.set("pass", "0")
    layer_el.set("class", "SimpleMarker")
    layer_el.set("enabled", "1")
    layer_el.set("locked", "0")

    props = ET.SubElement(layer_el, "Option")
    props.set("type", "Map")

    for name, value in [("color", color), ("name", "circle"), ("size", "1.5"), ("size_unit", "MM")]:
        opt = ET.SubElement(props, "Option")
        opt.set("type", "QString")
        opt.set("name", name)
        opt.set("value", value)

    return renderer


# Canonical EPSG:4326 spatial-reference block. The OES GPKG is always written in
# WGS84 (see gpkg_spatial_ref_sys / gpkg_geometry_columns in create_gpkg), so every
# OES maplayer must carry this CRS. Without an <srs>, QGIS/QField treats the vector
# layer as invalid and the field tablet shows a red "!" (broken datasource). This
# bit the individual boards (Lawley/Mohadin/Mamelodi/Etwatwa) whose .qgs had no
# layer to clone a CRS from, so they fell through to the from-scratch maplayer
# branch below which emitted no <srs>. Master/THM1 only worked by luck of having a
# correctly-named template layer to deep-copy.
SRS_4326_XML = (
    '<srs><spatialrefsys nativeFormat="Wkt">'
    '<wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",'
    'MEMBER["World Geodetic System 1984 (Transit)"],'
    'MEMBER["World Geodetic System 1984 (G730)"],'
    'MEMBER["World Geodetic System 1984 (G873)"],'
    'MEMBER["World Geodetic System 1984 (G1150)"],'
    'MEMBER["World Geodetic System 1984 (G1674)"],'
    'MEMBER["World Geodetic System 1984 (G1762)"],'
    'MEMBER["World Geodetic System 1984 (G2139)"],'
    'MEMBER["World Geodetic System 1984 (G2296)"],'
    'ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],'
    'ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,'
    'ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],'
    'AXIS["geodetic latitude (Lat)",north,ORDER[1],'
    'ANGLEUNIT["degree",0.0174532925199433]],'
    'AXIS["geodetic longitude (Lon)",east,ORDER[2],'
    'ANGLEUNIT["degree",0.0174532925199433]],'
    'USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],'
    'BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>'
    '<proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>'
    '<srsid>3452</srsid><srid>4326</srid><authid>EPSG:4326</authid>'
    '<description>WGS 84</description>'
    '<projectionacronym>longlat</projectionacronym>'
    '<ellipsoidacronym>EPSG:7030</ellipsoidacronym>'
    '<geographicflag>true</geographicflag>'
    '</spatialrefsys></srs>'
)


def ensure_srs_4326(maplayer):
    """Guarantee the maplayer carries an EPSG:4326 <srs> block.

    QField marks CRS-less vector layers invalid (red "!"). The OES GPKG is always
    WGS84, so replace any existing/missing <srs> with the canonical 4326 block,
    preserving its position in the element so QGIS reads it normally.
    """
    existing = maplayer.find("srs")
    idx = list(maplayer).index(existing) if existing is not None else 0
    if existing is not None:
        maplayer.remove(existing)
    maplayer.insert(idx, ET.fromstring(SRS_4326_XML))


def fetch_oes_data_by_project() -> Dict[str, Dict[str, List[Tuple]]]:
    """
    Fetch OES data grouped by FF project_id.
    Returns: {project_id: {'activated': [(dr, lat, lon), ...], 'remaining': [(dr, lat, lon), ...]}}
    """
    import psycopg2

    logger.info("Connecting to Neon database...")
    conn = psycopg2.connect(NEON_DATABASE_URL)
    cursor = conn.cursor()

    # Fetch all activated DRs with project_id
    logger.info("Fetching all activated DRs grouped by project...")
    cursor.execute("""
        SELECT oes.drop_number,
               CAST(COALESCE(NULLIF(d.latitude, 0), oes.latitude) AS FLOAT) as lat,
               CAST(COALESCE(NULLIF(d.longitude, 0), oes.longitude) AS FLOAT) as lon,
               d.project_id::text
        FROM oes_activations oes
        INNER JOIN drops d ON oes.drop_id = d.id
        WHERE COALESCE(NULLIF(d.latitude, 0), oes.latitude) IS NOT NULL
          AND COALESCE(NULLIF(d.longitude, 0), oes.longitude) IS NOT NULL
        ORDER BY oes.drop_number
    """)
    all_raw = cursor.fetchall()

    by_project: Dict[str, Dict[str, List[Tuple]]] = {}

    for dr, lat, lon, pid in all_raw:
        if not is_valid_sa_coordinate(lat, lon):
            continue
        if pid not in by_project:
            by_project[pid] = {'activated': [], 'remaining': []}
        by_project[pid]['activated'].append((dr, lat, lon))

    activated_total = sum(len(v['activated']) for v in by_project.values())
    logger.info(f"Fetched {activated_total} activated DRs across {len(by_project)} projects")

    # Fetch remaining DRs with project_id
    logger.info("Fetching remaining unactivated DRs grouped by project...")
    cursor.execute("""
        SELECT d.drop_number,
               CAST(d.latitude AS FLOAT) as lat,
               CAST(d.longitude AS FLOAT) as lon,
               d.project_id::text
        FROM drops d
        WHERE NOT EXISTS (
            SELECT 1 FROM oes_activations oes WHERE oes.drop_id = d.id
        )
          AND d.latitude IS NOT NULL
          AND d.longitude IS NOT NULL
          AND d.latitude != 0
          AND d.longitude != 0
        ORDER BY d.drop_number
    """)
    remaining_raw = cursor.fetchall()

    for dr, lat, lon, pid in remaining_raw:
        if not is_valid_sa_coordinate(lat, lon):
            continue
        if pid not in by_project:
            by_project[pid] = {'activated': [], 'remaining': []}
        by_project[pid]['remaining'].append((dr, lat, lon))

    remaining_total = sum(len(v['remaining']) for v in by_project.values())
    logger.info(f"Fetched {remaining_total} remaining DRs across {len(by_project)} projects")

    cursor.close()
    conn.close()

    return by_project


def create_gpkg(records_activated: List[Tuple], records_remaining: List[Tuple],
                output_dir: str, report_date: datetime) -> Tuple[str, str, str, str, str]:
    """Create GeoPackage with two tables for a specific set of records."""
    date_str = report_date.strftime("%d%m%Y")
    # Stable, non-dated names: the overlay overwrites the same GPKG/layers in place
    # each run instead of creating a new dated file daily. Dated files rotted the
    # .qgs (old GPKGs got emptied while layer refs lingered) and broke QFieldCloud
    # packaging. The report date is preserved in the layer description below, not the
    # filename or layer id, so it can never produce a dangling reference.
    gpkg_filename = "OES FF.gpkg"

    all_table = "oes_ff_all"
    remaining_table = "ff_remaining"
    all_layer_name = "OES FF Activated"
    remaining_layer_name = "OES FF Remaining"

    gpkg_path = os.path.join(output_dir, gpkg_filename)

    if os.path.exists(gpkg_path):
        os.remove(gpkg_path)

    logger.info(f"Creating {gpkg_filename}: {len(records_activated)} activated, {len(records_remaining)} remaining")

    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()

    cur.execute("""CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT,
        organization_coordsys_id INTEGER, definition TEXT, description TEXT)""")
    cur.execute("INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84', 4326, 'EPSG', 4326, 'GEOGCS[\"WGS 84\"]', 'WGS 84')")

    cur.execute("""CREATE TABLE gpkg_contents (
        table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT,
        description TEXT, last_change TEXT, min_x REAL, min_y REAL,
        max_x REAL, max_y REAL, srs_id INTEGER)""")

    cur.execute("""CREATE TABLE gpkg_geometry_columns (
        table_name TEXT, column_name TEXT, geometry_type_name TEXT,
        srs_id INTEGER, z INTEGER, m INTEGER)""")

    for table_name, records in [(all_table, records_activated), (remaining_table, records_remaining)]:
        cur.execute(f'''CREATE TABLE "{table_name}" (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB,
            "Pole Nr" TEXT,
            "Vlook" TEXT,
            lat REAL,
            lon REAL
        )''')

        _desc = f"OES activation overlay — updated {date_str}"
        cur.execute("INSERT INTO gpkg_contents VALUES (?, 'features', ?, ?, datetime('now'), NULL, NULL, NULL, NULL, 4326)",
                    (table_name, table_name, _desc))
        cur.execute("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', 4326, 0, 0)", (table_name,))

        for drop_number, lat, lon in records:
            geom = create_gpkg_point(float(lon), float(lat))
            cur.execute(f'INSERT INTO "{table_name}" (geom, "Pole Nr", "Vlook", lat, lon) VALUES (?, ?, ?, ?, ?)',
                       (geom, drop_number, drop_number, float(lat), float(lon)))

    conn.commit()
    conn.close()

    return gpkg_filename, all_table, all_layer_name, remaining_table, remaining_layer_name


def update_qgs_with_layers(client, project_id: str, gpkg_filename: str,
                           all_table: str, all_layer_name: str,
                           remaining_table: str, remaining_layer_name: str,
                           output_dir: str) -> str:
    """Download .qgs, add both layers inside 'OES Report' group."""
    from qfieldcloud_sdk import sdk

    files = client.list_remote_files(project_id)

    client.download_files(
        files=files,
        project_id=project_id,
        download_type=sdk.FileTransferType.PROJECT,
        local_dir=output_dir,
        filter_glob="*.qgs"
    )

    qgs_path = None
    qgs_name = None
    for f in os.listdir(output_dir):
        if f.endswith(".qgs"):
            qgs_path = os.path.join(output_dir, f)
            qgs_name = f
            break

    if not qgs_path:
        logger.error("No .qgs file found in project")
        return None

    logger.info(f"Updating {qgs_name}")

    tree = ET.parse(qgs_path)
    root = tree.getroot()

    layer_tree = root.find(".//layer-tree-group")
    oes_group = None
    for group in layer_tree.findall("layer-tree-group"):
        if group.get("name") == "OES Report":
            oes_group = group
            break

    if oes_group is None:
        logger.info("Creating 'OES Report' group")
        oes_group = ET.Element("layer-tree-group")
        oes_group.set("name", "OES Report")
        oes_group.set("checked", "Qt::Checked")
        oes_group.set("expanded", "1")
        layer_tree.insert(0, oes_group)

    projectlayers = root.find(".//projectlayers")

    template_maplayer = None
    for ml in projectlayers.findall("maplayer"):
        ln_el = ml.find("layername")
        if ln_el is not None and "OES" in ln_el.text and ("All" in ln_el.text or "Actual" in ln_el.text):
            if ml.find("extent") is not None:
                template_maplayer = ml
                break

    if template_maplayer is None:
        for ml in projectlayers.findall("maplayer"):
            ln_el = ml.find("layername")
            if ln_el is not None and ln_el.text in ["PONs", "POP", "PONs_1"]:
                if ml.find("extent") is not None:
                    template_maplayer = ml
                    break

    # Clean ALL legacy dated OES/FF layers from previous syncs (prevent accumulation).
    # Match on the datasource FILE ref (drift-proof) as well as the display name:
    # historical layer names drifted (e.g. "FF Remaining DR's 25052026 " with an
    # apostrophe + trailing space) and evaded name-only regexes, so a ref to a deleted
    # dated GPKG lingered and broke QFieldCloud packaging. The new stable layers
    # ("OES FF Activated"/"OES FF Remaining") carry no digits, so they survive cleanup
    # and are overwritten in place by the per-display-name dedupe in the add loop below.
    import re as _re
    _file_pat = _re.compile(r'OES FF \d{8}\.gpkg')          # dated gpkg file ref in datasource
    _name_pats = [
        _re.compile(r'OES FF \d{8}'),                        # OES FF DDMMYYYY [All]
        _re.compile(r"FF Remaining DR'?s?\s*\d{8}"),         # FF Remaining DR(s|'s) DDMMYYYY (+stray space)
        _re.compile(r'OES \d{2}-\d{2}-\d{2}'),               # OES DD-MM-YY (very old)
        _re.compile(r'Remaining_connections_'),
        _re.compile(r'ONT_Status_'),
    ]

    def _is_old_name(s):
        return any(p.search(s or '') for p in _name_pats)

    def _is_old_src(s):
        return bool(_file_pat.search(s or ''))

    _removed = 0
    # 1) projectlayers/maplayer: remove stale, collecting their ids for tree/order cleanup
    _stale_ids = set()
    for maplayer in list(projectlayers):
        ln = maplayer.find('layername')
        ds = maplayer.find('datasource')
        idel = maplayer.find('id')
        name = ln.text if ln is not None else ''
        src = ds.text if ds is not None else ''
        if _is_old_name(name) or _is_old_src(src):
            if idel is not None and idel.text:
                _stale_ids.add(idel.text)
            if maplayer.get('id'):
                _stale_ids.add(maplayer.get('id'))
            projectlayers.remove(maplayer)
            _removed += 1
    # 2) layer-tree-layer anywhere (recursive), by name / source / stale id
    for parent in root.iter():
        for ltl in list(parent):
            if ltl.tag == 'layer-tree-layer' and (
                _is_old_name(ltl.get('name')) or _is_old_src(ltl.get('source'))
                or ltl.get('id') in _stale_ids
            ):
                parent.remove(ltl)
                _removed += 1
    # 3) custom-order entries referencing removed layers
    for co in root.iter('custom-order'):
        for item in list(co):
            if (item.text or '') in _stale_ids:
                co.remove(item)
                _removed += 1
    # 4) <legend> section (recursive legendgroup/legendlayer by name)
    legend = root.find('.//legend')
    if legend is not None:
        def _clean_legend(node):
            nonlocal _removed
            for child in list(node):
                if child.tag == 'legendlayer' and _is_old_name(child.get('name')):
                    node.remove(child)
                    _removed += 1
                elif child.tag == 'legendgroup':
                    if _is_old_name(child.get('name')):
                        node.remove(child)
                        _removed += 1
                    else:
                        _clean_legend(child)
        _clean_legend(legend)
    if _removed:
        logger.info(f"Cleaned {_removed} legacy OES layer references from .qgs")

    # Remaining FIRST so it renders below; Activated LAST so it renders on top.
    # Both use insert(0, ...) so last-inserted = topmost in QField layer tree.
    layers_config = [
        (remaining_table, remaining_layer_name, "255,165,0,255"),
        (all_table, all_layer_name, "222,49,99,255"),
    ]

    for table_name, layer_display_name, color in layers_config:
        datasource = f"./{gpkg_filename}|layername={table_name}"
        layer_id = f"{table_name}_{str(uuid.uuid4()).replace('-', '_')}"

        for ltl in list(oes_group):
            if ltl.get("name") == layer_display_name:
                oes_group.remove(ltl)

        for maplayer in list(projectlayers):
            layername = maplayer.find("layername")
            if layername is not None and layername.text == layer_display_name:
                projectlayers.remove(maplayer)

        new_ltl = ET.Element("layer-tree-layer")
        new_ltl.set("id", layer_id)
        new_ltl.set("name", layer_display_name)
        new_ltl.set("source", datasource)
        new_ltl.set("providerKey", "ogr")
        new_ltl.set("checked", "Qt::Checked")
        new_ltl.set("expanded", "1")
        new_ltl.set("legend_exp", "")
        oes_group.insert(0, new_ltl)

        if template_maplayer is not None:
            maplayer = copy.deepcopy(template_maplayer)
            maplayer.set("id", layer_id)
            id_el = maplayer.find("id")
            if id_el is not None:
                id_el.text = layer_id
            ds_el = maplayer.find("datasource")
            if ds_el is not None:
                ds_el.text = datasource
            ln_el = maplayer.find("layername")
            if ln_el is not None:
                ln_el.text = layer_display_name
            projectlayers.append(maplayer)
        else:
            maplayer = ET.SubElement(projectlayers, "maplayer")
            maplayer.set("id", layer_id)
            maplayer.set("geometry", "Point")
            maplayer.set("type", "vector")
            maplayer.set("wkbType", "Point")
            ds = ET.SubElement(maplayer, "datasource")
            ds.text = datasource
            ln = ET.SubElement(maplayer, "layername")
            ln.text = layer_display_name
            prov = ET.SubElement(maplayer, "provider")
            prov.text = "ogr"

        # Always stamp the WGS84 CRS — both the clone path (in case a future template
        # lacks an <srs>) and the from-scratch path (which never emits one). This is
        # the fix for the red "!" / invalid-layer on individual QField boards.
        ensure_srs_4326(maplayer)
        add_pole_nr_labeling(maplayer)
        set_renderer(maplayer, color)

    tree.write(qgs_path, encoding="UTF-8", xml_declaration=True)
    logger.info(f"Updated {qgs_name} with both layers")

    return qgs_path


def upload_to_qfieldcloud(output_dir: str, gpkg_filename: str,
                          all_table: str, all_layer_name: str,
                          remaining_table: str, remaining_layer_name: str,
                          project_id: str):
    """Upload files and trigger jobs for a single project."""
    from qfieldcloud_sdk import sdk

    logger.info(f"Connecting to QFieldCloud (project {project_id})...")
    client = sdk.Client(QFIELD_API_URL)
    client.login(QFIELD_USERNAME, QFIELD_PASSWORD)

    # Delete old OES gpkg files from QFieldCloud before uploading new one
    try:
        remote_files = client.list_remote_files(project_id)
        for rf in remote_files:
            rname = rf.get('name', '')
            if (rname.endswith('.gpkg') or rname.endswith('.geojson')) and rname != gpkg_filename:
                if 'OES' in rname or 'oes_' in rname or 'Remaining' in rname or 'ONT_Status' in rname:
                    try:
                        client.delete_files(project_id, glob_patterns=[rname])
                        logger.info(f"  Deleted old file: {rname}")
                    except Exception as e:
                        logger.warning(f"  Could not delete {rname}: {e}")
    except Exception as e:
        logger.warning(f"Could not clean old files: {e}")

    logger.info(f"Uploading {gpkg_filename}...")
    result = list(client.upload_files(
        project_id=project_id,
        upload_type=sdk.FileTransferType.PROJECT,
        project_path=output_dir,
        filter_glob="*.gpkg"
    ))
    for r in result:
        logger.info(f"  {r.get('name')} - {r.get('status')}")

    qgs_path = update_qgs_with_layers(client, project_id, gpkg_filename,
                                       all_table, all_layer_name,
                                       remaining_table, remaining_layer_name,
                                       output_dir)

    if qgs_path:
        logger.info("Uploading updated .qgs...")
        result = list(client.upload_files(
            project_id=project_id,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=output_dir,
            filter_glob="*.qgs"
        ))
        for r in result:
            logger.info(f"  {r.get('name')} - {r.get('status')}")

    logger.info("Waiting 10s before triggering jobs...")
    time.sleep(10)

    logger.info("Triggering process_projectfile...")
    job1 = client.job_trigger(project_id, sdk.JobTypes.PROCESS_PROJECTFILE)
    logger.info(f"Job: {job1['id']}")

    for i in range(30):
        time.sleep(2)
        status = client.job_status(job1['id'])
        if status['status'] in ['finished', 'failed']:
            logger.info(f"process_projectfile: {status['status']}")
            if status['status'] == 'failed':
                logger.error(f"Error: {status.get('feedback', {}).get('error', '?')[:300]}")
                return False
            break

    time.sleep(10)

    logger.info("Triggering package...")
    job2 = client.job_trigger(project_id, sdk.JobTypes.PACKAGE)
    logger.info(f"Job: {job2['id']}")

    for i in range(60):
        time.sleep(2)
        status = client.job_status(job2['id'])
        if status['status'] in ['finished', 'failed']:
            logger.info(f"package: {status['status']}")
            if status['status'] == 'failed':
                logger.error(f"Error: {status.get('feedback', {}).get('error', '?')[:300]}")
                return False
            break

    return True


def main():
    parser = argparse.ArgumentParser(description='Sync OES data to QFieldCloud (project-split)')
    parser.add_argument('--full', action='store_true', help='Full sync')
    parser.add_argument('--report-date', type=str, help='Report date YYYY-MM-DD')
    args = parser.parse_args()

    missing = [n for n, v in (('NEON_DATABASE_URL', NEON_DATABASE_URL),
                              ('QFIELD_PASSWORD', QFIELD_PASSWORD)) if not v]
    if missing:
        logger.error(f"Missing required env var(s): {', '.join(missing)}. "
                     "Export them (the nightly wrapper sources them from the prod .env).")
        sys.exit(1)

    report_date = parse_report_date(args.report_date)

    logger.info("=" * 60)
    logger.info("OES to QFieldCloud Sync (PROJECT-SPLIT)")
    logger.info(f"Report Date: {report_date.strftime('%Y-%m-%d')}")
    logger.info("=" * 60)

    import shutil
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR, ignore_errors=True)
        # If rmtree failed (cross-user permissions), try subprocess
        if os.path.exists(OUTPUT_DIR):
            import subprocess
            subprocess.run(['rm', '-rf', OUTPUT_DIR], check=False)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Fetch sync targets (QField project -> FF project IDs mapping)
    sync_targets = fetch_sync_targets()
    if not sync_targets:
        logger.error("No sync targets found")
        sys.exit(1)

    # Fetch ALL OES data grouped by FF project
    data_by_project = fetch_oes_data_by_project()
    if not data_by_project:
        logger.warning("No records to sync")
        return

    success_count = 0
    fail_count = 0

    for target in sync_targets:
        qf_pid = target['qfield_project_id']
        qf_name = target['qfield_name']
        ff_pids = target['ff_project_ids']

        logger.info("-" * 60)
        logger.info(f"Syncing to {qf_name} ({qf_pid})")
        logger.info(f"  Linked FF projects: {ff_pids}")

        # Collect records for this target's linked FF projects
        activated = []
        remaining = []
        for ff_pid in ff_pids:
            proj_data = data_by_project.get(ff_pid, {})
            activated.extend(proj_data.get('activated', []))
            remaining.extend(proj_data.get('remaining', []))

        logger.info(f"  {len(activated)} activated + {len(remaining)} remaining DRs")

        if not activated and not remaining:
            logger.info(f"  Skipping {qf_name} — no data for linked projects")
            continue

        # Create project-specific GPKG
        project_dir = os.path.join(OUTPUT_DIR, qf_pid.replace('-', '_'))
        if os.path.exists(project_dir):
            shutil.rmtree(project_dir)
        os.makedirs(project_dir, exist_ok=True)

        gpkg_filename, all_table, all_layer_name, remaining_table, remaining_layer_name = \
            create_gpkg(activated, remaining, project_dir, report_date)

        try:
            ok = upload_to_qfieldcloud(project_dir, gpkg_filename,
                                        all_table, all_layer_name,
                                        remaining_table, remaining_layer_name,
                                        project_id=qf_pid)
            if ok:
                success_count += 1
                logger.info(f"SUCCESS: {qf_name}")
            else:
                fail_count += 1
                logger.error(f"FAILED: {qf_name}")
        except Exception as e:
            fail_count += 1
            logger.error(f"FAILED: {qf_name}: {e}")

    total_activated = sum(len(v.get('activated', [])) for v in data_by_project.values())
    total_remaining = sum(len(v.get('remaining', [])) for v in data_by_project.values())

    logger.info("=" * 60)
    logger.info(f"DONE: {success_count}/{len(sync_targets)} projects synced successfully")
    logger.info(f"  {total_activated} activated + {total_remaining} remaining DRs total")
    logger.info("=" * 60)

    if fail_count > 0 and success_count == 0:
        logger.error("All syncs failed")
        sys.exit(1)


if __name__ == '__main__':
    main()
