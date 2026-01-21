#!/usr/bin/env python3
"""
Sync OES activation data from FibreFlow (Neon) to QFieldCloud.

This script uses the WORKING approach from Louis's import_excel.py:
1. Query data from Neon PostgreSQL view
2. Create GeoPackage with proper WKB geometry (GP header + WKB point)
3. Create QGIS project file (.qgs) with relative paths
4. Upload via qfieldcloud-sdk (NOT direct to MinIO)
5. Trigger process_projectfile + package jobs

Usage:
    python3 sync_oes_db_to_qfield.py [--full]

Environment:
    NEON_DATABASE_URL - Neon PostgreSQL connection string
    QFIELD_USERNAME - QFieldCloud username
    QFIELD_PASSWORD - QFieldCloud password
    QFIELD_PROJECT_ID - Target QFieldCloud project UUID

Author: Hein/Claude Code (based on Louis's working import_excel.py)
Date: 2026-01-21
"""

import os
import sys
import sqlite3
import struct
import logging
from datetime import datetime
from typing import List, Dict, Tuple, Optional

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

QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME', 'Jaun')
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD', 'TestPass123')
# Use Hein's test project for OES sync
QFIELD_PROJECT_ID = os.environ.get('QFIELD_PROJECT_ID', '04ee5213-19dc-433f-9889-3b83286ade09')  # OES_Excel_Test_Hein_2026-01-21
QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')

# Whether to upload QGIS project file (set to False for existing projects with .qgs already)
# Default to False since most projects already have a .qgs file
UPLOAD_QGS = os.environ.get('UPLOAD_QGS', 'false').lower() == 'true'

OUTPUT_DIR = '/tmp/qfield_oes_sync'
LAYER_NAME = 'OES_Activations'
PROJECT_NAME = 'OES_Activations_Sync'


def create_gpkg_point(lon: float, lat: float) -> bytes:
    """
    Create GeoPackage point geometry (WKB with GPKG header).

    This is the CRITICAL part - must match Louis's working implementation:
    - GP header: magic bytes, version, flags, SRID
    - WKB Point: byte order, geometry type, X, Y
    """
    # GP header: magic, version, flags, srs_id
    header = b'GP'  # magic bytes
    header += struct.pack('<B', 0)  # version
    header += struct.pack('<B', 1)  # flags (little endian, non-empty envelope)
    header += struct.pack('<i', 4326)  # srs_id (WGS84)

    # WKB Point
    wkb = struct.pack('<B', 1)  # byte order (little endian)
    wkb += struct.pack('<I', 1)  # geometry type (1 = Point)
    wkb += struct.pack('<d', lon)  # X (longitude)
    wkb += struct.pack('<d', lat)  # Y (latitude)

    return header + wkb


def fetch_oes_data() -> Tuple[List[Dict], Tuple[float, float, float, float]]:
    """
    Fetch OES data from Neon PostgreSQL view.

    Returns:
        Tuple of (list of records, bounds tuple (min_lon, min_lat, max_lon, max_lat))
    """
    try:
        import psycopg2
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    logger.info("Connecting to Neon database...")
    conn = psycopg2.connect(NEON_DATABASE_URL)
    cursor = conn.cursor()

    # Fetch data from view
    logger.info("Fetching OES data from v_qfield_oes_activations...")
    cursor.execute("""
        SELECT
            drop_number,
            activation_date,
            serial_number,
            CAST(latitude AS FLOAT) as latitude,
            CAST(longitude AS FLOAT) as longitude,
            zone,
            pon,
            project_name,
            CAST(ont_rx_sig_dbm AS FLOAT) as ont_rx_sig_dbm,
            CAST(olt_rx_sig_dbm AS FLOAT) as olt_rx_sig_dbm,
            olt_address,
            status,
            team
        FROM v_qfield_oes_activations
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude != 0
          AND longitude != 0
        ORDER BY drop_number
    """)

    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchall()

    logger.info(f"Fetched {len(rows)} records with valid coordinates")

    # Convert to list of dicts
    records = []
    min_lon, min_lat = float('inf'), float('inf')
    max_lon, max_lat = float('-inf'), float('-inf')

    for row in rows:
        record = dict(zip(columns, row))
        records.append(record)

        # Track bounds
        lat, lon = record['latitude'], record['longitude']
        min_lon = min(min_lon, lon)
        min_lat = min(min_lat, lat)
        max_lon = max(max_lon, lon)
        max_lat = max(max_lat, lat)

    bounds = (min_lon, min_lat, max_lon, max_lat)

    cursor.close()
    conn.close()

    return records, bounds


def create_geopackage(records: List[Dict], gpkg_path: str) -> int:
    """
    Create GeoPackage file with proper structure.

    This follows the GeoPackage spec and matches Louis's working implementation.
    """
    if os.path.exists(gpkg_path):
        os.remove(gpkg_path)

    logger.info(f"Creating GeoPackage: {gpkg_path}")

    conn = sqlite3.connect(gpkg_path)

    # Create GeoPackage structure (required tables)
    conn.executescript('''
        -- Spatial Reference System table
        CREATE TABLE gpkg_spatial_ref_sys (
            srs_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL PRIMARY KEY,
            organization TEXT NOT NULL,
            organization_coordsys_id INTEGER NOT NULL,
            definition TEXT NOT NULL,
            description TEXT
        );

        -- Add WGS84 definition
        INSERT INTO gpkg_spatial_ref_sys VALUES
            ('WGS 84 geodetic', 4326, 'EPSG', 4326,
             'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
             'longitude/latitude coordinates in decimal degrees on the WGS 84 spheroid');

        -- Contents table (layer registry)
        CREATE TABLE gpkg_contents (
            table_name TEXT NOT NULL PRIMARY KEY,
            data_type TEXT NOT NULL,
            identifier TEXT UNIQUE,
            description TEXT DEFAULT '',
            last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            min_x DOUBLE,
            min_y DOUBLE,
            max_x DOUBLE,
            max_y DOUBLE,
            srs_id INTEGER,
            CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id)
        );

        -- Geometry columns table
        CREATE TABLE gpkg_geometry_columns (
            table_name TEXT NOT NULL,
            column_name TEXT NOT NULL,
            geometry_type_name TEXT NOT NULL,
            srs_id INTEGER NOT NULL,
            z INTEGER NOT NULL,
            m INTEGER NOT NULL,
            CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name),
            CONSTRAINT fk_gc_tn FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name),
            CONSTRAINT fk_gc_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys (srs_id)
        );
    ''')

    # Create feature table
    conn.execute(f'''
        CREATE TABLE {LAYER_NAME} (
            fid INTEGER PRIMARY KEY AUTOINCREMENT,
            geom BLOB,
            drop_number TEXT,
            activation_date TEXT,
            serial_number TEXT,
            latitude REAL,
            longitude REAL,
            zone TEXT,
            pon TEXT,
            project_name TEXT,
            ont_rx_sig_dbm REAL,
            olt_rx_sig_dbm REAL,
            olt_address TEXT,
            status TEXT,
            team TEXT,
            label TEXT
        )
    ''')

    # Calculate bounds
    min_lon = min(r['longitude'] for r in records)
    min_lat = min(r['latitude'] for r in records)
    max_lon = max(r['longitude'] for r in records)
    max_lat = max(r['latitude'] for r in records)

    # Register layer in gpkg tables
    conn.execute('''
        INSERT INTO gpkg_contents VALUES
            (?, 'features', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?, ?, ?, ?, 4326)
    ''', (LAYER_NAME, LAYER_NAME, 'OES Activation Points from FibreFlow', min_lon, min_lat, max_lon, max_lat))

    conn.execute('''
        INSERT INTO gpkg_geometry_columns VALUES
            (?, 'geom', 'POINT', 4326, 0, 0)
    ''', (LAYER_NAME,))

    # Insert records
    insert_sql = f'''
        INSERT INTO {LAYER_NAME} (
            geom, drop_number, activation_date, serial_number,
            latitude, longitude, zone, pon, project_name,
            ont_rx_sig_dbm, olt_rx_sig_dbm, olt_address, status, team, label
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    '''

    count = 0
    for record in records:
        try:
            geom = create_gpkg_point(record['longitude'], record['latitude'])

            # Format activation date
            act_date = record['activation_date']
            if hasattr(act_date, 'strftime'):
                act_date = act_date.strftime('%Y-%m-%d')

            values = (
                geom,
                record['drop_number'],
                str(act_date) if act_date else None,
                record['serial_number'],
                record['latitude'],
                record['longitude'],
                record['zone'],
                record['pon'],
                record['project_name'],
                record['ont_rx_sig_dbm'],
                record['olt_rx_sig_dbm'],
                record['olt_address'],
                record['status'],
                record['team'],
                record['drop_number']  # Label for map display
            )
            conn.execute(insert_sql, values)
            count += 1
        except Exception as e:
            logger.warning(f"Skipping record {record.get('drop_number')}: {e}")

    conn.commit()
    conn.close()

    logger.info(f"Created GeoPackage with {count} features")
    return count


def create_qgis_project(gpkg_filename: str, qgs_path: str, bounds: Tuple[float, float, float, float]):
    """
    Create QGIS project file (.qgs) with relative paths.

    CRITICAL: Must use relative path ./filename.gpkg, not absolute path!
    """
    min_x, min_y, max_x, max_y = bounds

    qgs_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="{PROJECT_NAME}" version="3.28.0-Firenze">
  <title>{PROJECT_NAME}</title>
  <projectCrs>
    <spatialrefsys>
      <authid>EPSG:4326</authid>
    </spatialrefsys>
  </projectCrs>
  <layer-tree-group>
    <layer-tree-layer checked="Qt::Checked" id="{LAYER_NAME}_layer" name="{LAYER_NAME}" providerKey="ogr" source="./{gpkg_filename}|layername={LAYER_NAME}">
    </layer-tree-layer>
  </layer-tree-group>
  <mapcanvas name="theMapCanvas">
    <extent>
      <xmin>{min_x}</xmin>
      <ymin>{min_y}</ymin>
      <xmax>{max_x}</xmax>
      <ymax>{max_y}</ymax>
    </extent>
    <destinationsrs>
      <spatialrefsys>
        <authid>EPSG:4326</authid>
      </spatialrefsys>
    </destinationsrs>
  </mapcanvas>
  <projectlayers>
    <maplayer geometry="Point" id="{LAYER_NAME}_layer" type="vector">
      <extent>
        <xmin>{min_x}</xmin>
        <ymin>{min_y}</ymin>
        <xmax>{max_x}</xmax>
        <ymax>{max_y}</ymax>
      </extent>
      <id>{LAYER_NAME}_layer</id>
      <datasource>./{gpkg_filename}|layername={LAYER_NAME}</datasource>
      <layername>{LAYER_NAME}</layername>
      <srs>
        <spatialrefsys>
          <authid>EPSG:4326</authid>
        </spatialrefsys>
      </srs>
      <renderer-v2 type="singleSymbol">
        <symbols>
          <symbol name="0" type="marker">
            <layer class="SimpleMarker">
              <Option type="Map">
                <Option name="color" value="255,0,0,255"/>
                <Option name="name" value="circle"/>
                <Option name="size" value="3"/>
              </Option>
            </layer>
          </symbol>
        </symbols>
      </renderer-v2>
      <labeling type="simple">
        <settings>
          <text-style fieldName="label" fontSize="8" textColor="0,0,0,255"/>
          <text-buffer bufferDraw="1" bufferSize="1" bufferColor="255,255,255,255"/>
        </settings>
      </labeling>
    </maplayer>
  </projectlayers>
</qgis>'''

    with open(qgs_path, 'w') as f:
        f.write(qgs_content)

    logger.info(f"Created QGIS project: {qgs_path}")


def upload_to_qfieldcloud(upload_dir: str, upload_qgs: bool = True):
    """
    Upload files to QFieldCloud using SDK.

    CRITICAL: Must use qfieldcloud-sdk, NOT direct MinIO upload!

    Args:
        upload_dir: Directory containing files to upload
        upload_qgs: Whether to upload QGIS project file (set False if project already has .qgs)
    """
    try:
        from qfieldcloud_sdk import sdk
        from pathlib import Path
    except ImportError:
        logger.error("qfieldcloud-sdk not installed. Run: pip install qfieldcloud-sdk")
        sys.exit(1)

    logger.info(f"Connecting to QFieldCloud at {QFIELD_API_URL}...")
    client = sdk.Client(url=QFIELD_API_URL)
    client.login(QFIELD_USERNAME, QFIELD_PASSWORD)
    logger.info(f"Logged in as {QFIELD_USERNAME}")

    # Upload GeoPackage file first
    logger.info("Uploading GeoPackage file...")
    gpkg_results = client.upload_files(
        project_id=QFIELD_PROJECT_ID,
        upload_type=sdk.FileTransferType.PROJECT,
        project_path=upload_dir,
        filter_glob="*.gpkg",
        throw_on_error=True,
        force=True
    )
    for r in gpkg_results:
        logger.info(f"  - {r['name']}: {r['status']}")

    # Optionally upload QGIS project file
    if upload_qgs:
        logger.info("Uploading QGIS project file...")
        qgs_results = client.upload_files(
            project_id=QFIELD_PROJECT_ID,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=upload_dir,
            filter_glob="*.qgs",
            throw_on_error=True,
            force=True
        )
        for r in qgs_results:
            logger.info(f"  - {r['name']}: {r['status']}")
    else:
        logger.info("Skipping QGIS project upload (UPLOAD_QGS=false)")

    # Trigger processing jobs
    logger.info("Triggering process_projectfile job...")
    job1 = client.job_trigger(QFIELD_PROJECT_ID, sdk.JobTypes.PROCESS_PROJECTFILE, force=True)
    logger.info(f"  Job ID: {job1['id']}")

    logger.info("Triggering package job...")
    job2 = client.job_trigger(QFIELD_PROJECT_ID, sdk.JobTypes.PACKAGE, force=True)
    logger.info(f"  Job ID: {job2['id']}")

    return True


def main():
    """Main entry point."""
    full_sync = '--full' in sys.argv

    logger.info("=" * 60)
    logger.info("OES to QFieldCloud Sync Starting")
    logger.info(f"Target Project: {QFIELD_PROJECT_ID}")
    logger.info(f"Mode: {'FULL' if full_sync else 'INCREMENTAL'}")
    logger.info("=" * 60)

    try:
        # Step 1: Fetch data from Neon
        records, bounds = fetch_oes_data()

        if not records:
            logger.warning("No records to sync")
            return 0

        # Step 2: Create output directory
        os.makedirs(OUTPUT_DIR, exist_ok=True)

        gpkg_filename = f"{LAYER_NAME}.gpkg"
        qgs_filename = f"{PROJECT_NAME}.qgs"
        gpkg_path = os.path.join(OUTPUT_DIR, gpkg_filename)
        qgs_path = os.path.join(OUTPUT_DIR, qgs_filename)

        # Step 3: Create GeoPackage
        count = create_geopackage(records, gpkg_path)

        # Step 4: Create QGIS project (if needed)
        if UPLOAD_QGS:
            create_qgis_project(gpkg_filename, qgs_path, bounds)

        # Step 5: Upload to QFieldCloud
        upload_to_qfieldcloud(OUTPUT_DIR, upload_qgs=UPLOAD_QGS)

        logger.info("=" * 60)
        logger.info(f"Sync Complete: {count} records uploaded")
        logger.info("Data should be visible in QField app after jobs complete")
        logger.info("=" * 60)

        return 0

    except Exception as e:
        logger.error(f"Sync failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
