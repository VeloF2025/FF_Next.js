#!/usr/bin/env python3
"""
Sync OES activation data from FibreFlow (Neon) to QFieldCloud.

Updated version with TWO layers:
- OES Actual (blue) - where technician activated (from OES Excel GPS)
- Planned (green) - where drop was planned (from drops table)

This allows visual comparison of discrepancies between planned and actual locations.

Features:
- Filters out coordinates outside South Africa bounds
- Creates date-based layers: OES DD-MM-YY Actual, OES DD-MM-YY Planned
- Shows DR numbers as labels

Usage:
    python3 sync_oes_db_to_qfield.py [--full] [--report-date YYYY-MM-DD]

Author: Hein/Claude Code
Date: 2026-01-24
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/qfield-oes-sync.log', mode='a')
    ]
)
logger = logging.getLogger(__name__)

# Environment variables with defaults
NEON_DATABASE_URL = os.environ.get(
    'NEON_DATABASE_URL',
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
)

QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME', 'admin')
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD', '0203')
QFIELD_PROJECT_ID = os.environ.get('QFIELD_PROJECT_ID', 'e849b878-f8a8-4f84-a3f1-9fbd051686c0')
QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')

OUTPUT_DIR = '/tmp/qfield_oes_sync'

# South Africa bounds for filtering bad GPS data
SA_BOUNDS = {
    'min_lat': -35.0,
    'max_lat': -22.0,
    'min_lon': 16.0,
    'max_lon': 33.0
}


def is_valid_sa_coordinate(lat: float, lon: float) -> bool:
    """Check if coordinates are within South Africa bounds."""
    return (SA_BOUNDS['min_lat'] <= lat <= SA_BOUNDS['max_lat'] and
            SA_BOUNDS['min_lon'] <= lon <= SA_BOUNDS['max_lon'])


def parse_report_date(date_str: Optional[str]) -> datetime:
    """Parse report date string (YYYY-MM-DD) or return today."""
    if not date_str:
        return datetime.now()

    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        logger.warning(f"Invalid date format '{date_str}', using today")
        return datetime.now()


def create_gpkg_point(lon: float, lat: float) -> bytes:
    """Create GeoPackage point geometry (WKB with GPKG header)."""
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
    """Add labeling configuration to show 'Pole Nr' field as labels."""
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

    logger.info("Added 'Pole Nr' labeling configuration")
    return labeling


def set_renderer(maplayer, color: str = "0,100,255,255"):
    """Set simple single-symbol renderer with specified color (RGBA)."""
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

    color_opt = ET.SubElement(props, "Option")
    color_opt.set("type", "QString")
    color_opt.set("name", "color")
    color_opt.set("value", color)

    shape_opt = ET.SubElement(props, "Option")
    shape_opt.set("type", "QString")
    shape_opt.set("name", "name")
    shape_opt.set("value", "circle")

    size_opt = ET.SubElement(props, "Option")
    size_opt.set("type", "QString")
    size_opt.set("name", "size")
    size_opt.set("value", "3")

    size_unit = ET.SubElement(props, "Option")
    size_unit.set("type", "QString")
    size_unit.set("name", "size_unit")
    size_unit.set("value", "MM")

    return renderer


def fetch_oes_data() -> Dict[str, List[Tuple]]:
    """
    Fetch OES data with both actual and planned coordinates.
    Returns dict with 'actual' and 'planned' lists.
    """
    try:
        import psycopg2
    except ImportError:
        logger.error("psycopg2 not installed")
        sys.exit(1)

    logger.info("Connecting to Neon database...")
    conn = psycopg2.connect(NEON_DATABASE_URL)
    cursor = conn.cursor()

    # Fetch OES actual coordinates (from Excel GPS)
    logger.info("Fetching OES actual coordinates...")
    cursor.execute("""
        SELECT drop_number, oes_latitude, oes_longitude
        FROM v_qfield_oes_activations
        WHERE oes_latitude IS NOT NULL
          AND oes_longitude IS NOT NULL
          AND oes_latitude != 0
          AND oes_longitude != 0
        ORDER BY drop_number
    """)
    actual_raw = cursor.fetchall()

    # Filter to SA bounds
    actual = [(dr, lat, lon) for dr, lat, lon in actual_raw
              if is_valid_sa_coordinate(lat, lon)]
    filtered_actual = len(actual_raw) - len(actual)
    logger.info(f"Fetched {len(actual)} actual records ({filtered_actual} filtered outside SA)")

    # Fetch Planned coordinates (from drops table)
    logger.info("Fetching planned coordinates...")
    cursor.execute("""
        SELECT drop_number, planned_latitude, planned_longitude
        FROM v_qfield_oes_activations
        WHERE planned_latitude IS NOT NULL
          AND planned_longitude IS NOT NULL
          AND planned_latitude != 0
          AND planned_longitude != 0
        ORDER BY drop_number
    """)
    planned_raw = cursor.fetchall()

    # Filter to SA bounds
    planned = [(dr, lat, lon) for dr, lat, lon in planned_raw
               if is_valid_sa_coordinate(lat, lon)]
    filtered_planned = len(planned_raw) - len(planned)
    logger.info(f"Fetched {len(planned)} planned records ({filtered_planned} filtered outside SA)")

    cursor.close()
    conn.close()

    return {'actual': actual, 'planned': planned}


def create_gpkg_with_two_tables(data: Dict[str, List[Tuple]], output_dir: str, report_date: datetime) -> Tuple[str, str, str, str, str]:
    """
    Create GeoPackage with two tables: actual and planned.

    Returns: (gpkg_filename, actual_table, actual_layer_name, planned_table, planned_layer_name)
    """
    date_str = report_date.strftime("%d-%m-%y")
    gpkg_filename = f"OES {date_str}.gpkg"

    actual_table = f"oes_{report_date.strftime('%d%m%y')}_actual"
    planned_table = f"oes_{report_date.strftime('%d%m%y')}_planned"
    actual_layer_name = f"OES {date_str} Actual"
    planned_layer_name = f"OES {date_str} Planned"

    gpkg_path = os.path.join(output_dir, gpkg_filename)

    if os.path.exists(gpkg_path):
        os.remove(gpkg_path)

    logger.info(f"Creating {gpkg_filename} with tables {actual_table} and {planned_table}")

    conn = sqlite3.connect(gpkg_path)
    cur = conn.cursor()

    # GeoPackage metadata tables
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

    # Create both tables
    for table_name, records, label in [(actual_table, data['actual'], 'Actual'),
                                        (planned_table, data['planned'], 'Planned')]:
        cur.execute(f'''CREATE TABLE "{table_name}" (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB,
            "Pole Nr" TEXT,
            "Vlook" TEXT,
            lat REAL,
            lon REAL
        )''')

        cur.execute("INSERT INTO gpkg_contents VALUES (?, 'features', ?, '', datetime('now'), NULL, NULL, NULL, NULL, 4326)",
                    (table_name, table_name))
        cur.execute("INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POINT', 4326, 0, 0)", (table_name,))

        for drop_number, lat, lon in records:
            geom = create_gpkg_point(float(lon), float(lat))
            cur.execute(f'INSERT INTO "{table_name}" (geom, "Pole Nr", "Vlook", lat, lon) VALUES (?, ?, ?, ?, ?)',
                       (geom, drop_number, drop_number, float(lat), float(lon)))

        logger.info(f"Inserted {len(records)} records into {table_name} ({label})")

    conn.commit()
    conn.close()

    return gpkg_filename, actual_table, actual_layer_name, planned_table, planned_layer_name


def update_qgs_with_layers(client, project_id: str, gpkg_filename: str,
                           actual_table: str, actual_layer_name: str,
                           planned_table: str, planned_layer_name: str,
                           output_dir: str) -> str:
    """Download .qgs, add both layers inside "OES Report" group."""
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

    # Find or create "OES Report" group
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

    # Find template layer
    template_maplayer = None
    for ml in projectlayers.findall("maplayer"):
        ln_el = ml.find("layername")
        if ln_el is not None and "OES" in ln_el.text and ("All" in ln_el.text or "Actual" in ln_el.text):
            if ml.find("extent") is not None:
                template_maplayer = ml
                logger.info(f"Found OES template layer: {ln_el.text}")
                break

    if template_maplayer is None:
        for ml in projectlayers.findall("maplayer"):
            ln_el = ml.find("layername")
            if ln_el is not None and ln_el.text in ["PONs", "POP", "PONs_1"]:
                if ml.find("extent") is not None:
                    template_maplayer = ml
                    logger.info(f"Using fallback template layer: {ln_el.text}")
                    break

    # Add both layers
    layers_config = [
        (actual_table, actual_layer_name, "0,100,255,255"),   # Blue for actual
        (planned_table, planned_layer_name, "0,200,0,255"),   # Green for planned
    ]

    for table_name, layer_display_name, color in layers_config:
        datasource = f"./{gpkg_filename}|layername={table_name}"
        layer_id = f"{table_name}_{str(uuid.uuid4()).replace('-', '_')}"

        # Remove existing layer with same name
        for ltl in list(oes_group):
            if ltl.get("name") == layer_display_name:
                oes_group.remove(ltl)
                logger.info(f"Removed existing layer: {layer_display_name}")

        # Remove from projectlayers too
        for maplayer in list(projectlayers):
            layername = maplayer.find("layername")
            if layername is not None and layername.text == layer_display_name:
                projectlayers.remove(maplayer)

        # Add layer-tree-layer
        new_ltl = ET.Element("layer-tree-layer")
        new_ltl.set("id", layer_id)
        new_ltl.set("name", layer_display_name)
        new_ltl.set("source", datasource)
        new_ltl.set("providerKey", "ogr")
        new_ltl.set("checked", "Qt::Checked")
        new_ltl.set("expanded", "1")
        new_ltl.set("legend_exp", "")
        oes_group.insert(0, new_ltl)

        # Create maplayer
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
            logger.info(f"Cloned maplayer for {layer_display_name}")
        else:
            logger.warning(f"No template - creating minimal maplayer for {layer_display_name}")
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

        # Add labeling and renderer
        add_pole_nr_labeling(maplayer)
        set_renderer(maplayer, color)
        logger.info(f"Set {color.split(',')[1]}% green renderer for {layer_display_name}")

    tree.write(qgs_path, encoding="UTF-8", xml_declaration=True)
    logger.info(f"Updated {qgs_name} with both layers")

    return qgs_path


def upload_to_qfieldcloud(output_dir: str, gpkg_filename: str,
                          actual_table: str, actual_layer_name: str,
                          planned_table: str, planned_layer_name: str):
    """Upload files and trigger jobs."""
    from qfieldcloud_sdk import sdk

    logger.info("Connecting to QFieldCloud...")
    client = sdk.Client(QFIELD_API_URL)
    client.login(QFIELD_USERNAME, QFIELD_PASSWORD)

    project_id = QFIELD_PROJECT_ID

    # Upload gpkg
    logger.info(f"Uploading {gpkg_filename}...")
    result = list(client.upload_files(
        project_id=project_id,
        upload_type=sdk.FileTransferType.PROJECT,
        project_path=output_dir,
        filter_glob="*.gpkg"
    ))
    for r in result:
        logger.info(f"  {r.get('name')} - {r.get('status')}")

    # Update .qgs
    qgs_path = update_qgs_with_layers(client, project_id, gpkg_filename,
                                       actual_table, actual_layer_name,
                                       planned_table, planned_layer_name,
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

    outputs = status.get('feedback', {}).get('outputs', {})
    layers = outputs.get('qgis_layers_data', {}).get('layers_by_id', {})
    logger.info("Packaged layers:")
    for lid, linfo in layers.items():
        name = linfo.get('name', '?')
        valid = linfo.get('is_valid', '?')
        if 'OES' in name:
            logger.info(f"  {name} - valid: {valid}")

    return True


def main():
    """Main sync function."""
    parser = argparse.ArgumentParser(description='Sync OES data to QFieldCloud')
    parser.add_argument('--full', action='store_true', help='Full sync')
    parser.add_argument('--report-date', type=str, help='Report date YYYY-MM-DD')
    args = parser.parse_args()

    report_date = parse_report_date(args.report_date)

    logger.info("=" * 50)
    logger.info("OES to QFieldCloud Sync (Actual + Planned)")
    logger.info(f"Report Date: {report_date.strftime('%Y-%m-%d')}")
    logger.info("=" * 50)

    import shutil
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Fetch data (both actual and planned)
    data = fetch_oes_data()
    if not data['actual'] and not data['planned']:
        logger.warning("No records to sync")
        return

    # Create gpkg with both tables
    gpkg_filename, actual_table, actual_layer_name, planned_table, planned_layer_name = \
        create_gpkg_with_two_tables(data, OUTPUT_DIR, report_date)

    # Upload and trigger
    success = upload_to_qfieldcloud(OUTPUT_DIR, gpkg_filename,
                                     actual_table, actual_layer_name,
                                     planned_table, planned_layer_name)

    if success:
        logger.info("=" * 50)
        logger.info(f"SUCCESS: {len(data['actual'])} actual + {len(data['planned'])} planned records synced")
        logger.info(f"  {actual_layer_name} (blue) - where technician was")
        logger.info(f"  {planned_layer_name} (green) - where drop was planned")
        logger.info("=" * 50)
    else:
        logger.error("Sync failed")
        sys.exit(1)


if __name__ == '__main__':
    main()
