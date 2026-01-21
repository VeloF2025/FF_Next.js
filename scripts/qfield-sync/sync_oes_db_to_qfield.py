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
import time
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
# Target: FibreFlow_OES_Automations (dedicated project for FibreFlow sync)
QFIELD_PROJECT_ID = os.environ.get('QFIELD_PROJECT_ID', '067b51c8-6e96-4e0c-9462-d4890763758b')
QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')

# Whether to upload QGIS project file
# Must be True for the layer to appear in QField (references the gpkg)
UPLOAD_QGS = os.environ.get('UPLOAD_QGS', 'true').lower() == 'true'

OUTPUT_DIR = '/tmp/qfield_oes_sync'
# For Test_Project__Automations: uses "OES & Project Progress.gpkg"
# We'll add our OES data as a new layer in a file with similar name
GPKG_FILENAME = 'OES_Activations_Sync.gpkg'  # Our own file (won't conflict)
LAYER_NAME = 'OES_Activations'  # Our layer name
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

    CRITICAL:
    - Must use relative path ./filename.gpkg, not absolute path!
    - Must include <homePath path=""/> for relative path resolution
    - Must use proper QGIS XML format matching real QGIS output
    """
    min_x, min_y, max_x, max_y = bounds
    now = datetime.now().strftime('%Y-%m-%dT%H:%M:%S')

    # Generate unique layer ID (matches QGIS format)
    import uuid
    layer_id = f"{LAYER_NAME}_{str(uuid.uuid4()).replace('-', '_')}"

    qgs_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis saveDateTime="{now}" version="3.40.0-Bratislava" saveUserFull="FibreFlow" saveUser="fibreflow" projectname="{PROJECT_NAME}">
  <homePath path=""/>
  <title>{PROJECT_NAME}</title>
  <transaction mode="Disabled"/>
  <projectFlags set=""/>
  <projectCrs>
    <spatialrefsys nativeFormat="Wkt">
      <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
      <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
      <srsid>3452</srsid>
      <srid>4326</srid>
      <authid>EPSG:4326</authid>
      <description>WGS 84</description>
      <projectionacronym>longlat</projectionacronym>
      <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
      <geographicflag>true</geographicflag>
    </spatialrefsys>
  </projectCrs>
  <layer-tree-group>
    <customproperties>
      <Option/>
    </customproperties>
    <layer-tree-layer source="./{gpkg_filename}|layername={LAYER_NAME}" expanded="1" name="{LAYER_NAME}" legend_exp="" checked="Qt::Checked" patch_size="-1,-1" legend_split_behavior="0" id="{layer_id}" providerKey="ogr">
      <customproperties>
        <Option/>
      </customproperties>
    </layer-tree-layer>
    <custom-order enabled="0">
      <item>{layer_id}</item>
    </custom-order>
  </layer-tree-group>
  <snapping-settings maxScale="0" tolerance="12" scaleDependencyMode="0" unit="1" intersection-snapping="0" enabled="0" minScale="0" type="1" self-snapping="0" mode="2">
    <individual-layer-settings>
      <layer-setting maxScale="0" tolerance="12" enabled="0" minScale="0" id="{layer_id}" type="1" units="1"/>
    </individual-layer-settings>
  </snapping-settings>
  <relations/>
  <polymorphicRelations/>
  <mapcanvas name="theMapCanvas" annotationsVisible="1">
    <units>degrees</units>
    <extent>
      <xmin>{min_x}</xmin>
      <ymin>{min_y}</ymin>
      <xmax>{max_x}</xmax>
      <ymax>{max_y}</ymax>
    </extent>
    <rotation>0</rotation>
    <destinationsrs>
      <spatialrefsys nativeFormat="Wkt">
        <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
        <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
        <srsid>3452</srsid>
        <srid>4326</srid>
        <authid>EPSG:4326</authid>
        <description>WGS 84</description>
        <projectionacronym>longlat</projectionacronym>
        <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
        <geographicflag>true</geographicflag>
      </spatialrefsys>
    </destinationsrs>
    <rendermaptile>0</rendermaptile>
  </mapcanvas>
  <projectModels/>
  <legend updateDrawingOrder="true">
    <legendlayer name="{LAYER_NAME}" checked="Qt::Checked" open="true" drawingOrder="-1" showFeatureCount="0">
      <filegroup open="true" hidden="false">
        <legendlayerfile layerid="{layer_id}" visible="1" isInOverview="0"/>
      </filegroup>
    </legendlayer>
  </legend>
  <projectlayers>
    <maplayer hasScaleBasedVisibilityFlag="0" type="vector" simplifyDrawingHints="0" readOnly="0" legendPlaceholderImage="" geometry="Point" labelsEnabled="1" simplifyMaxScale="1" simplifyDrawingTol="1" wkbType="Point" minScale="100000000" styleCategories="AllStyleCategories" refreshOnNotifyEnabled="0" symbologyReferenceScale="-1" autoRefreshTime="0" autoRefreshMode="Disabled" simplifyAlgorithm="0" simplifyLocal="1" refreshOnNotifyMessage="" maxScale="0">
      <extent>
        <xmin>{min_x}</xmin>
        <ymin>{min_y}</ymin>
        <xmax>{max_x}</xmax>
        <ymax>{max_y}</ymax>
      </extent>
      <wgs84extent>
        <xmin>{min_x}</xmin>
        <ymin>{min_y}</ymin>
        <xmax>{max_x}</xmax>
        <ymax>{max_y}</ymax>
      </wgs84extent>
      <id>{layer_id}</id>
      <datasource>./{gpkg_filename}|layername={LAYER_NAME}</datasource>
      <keywordList>
        <value></value>
      </keywordList>
      <layername>{LAYER_NAME}</layername>
      <srs>
        <spatialrefsys nativeFormat="Wkt">
          <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
          <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
          <srsid>3452</srsid>
          <srid>4326</srid>
          <authid>EPSG:4326</authid>
          <description>WGS 84</description>
          <projectionacronym>longlat</projectionacronym>
          <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
          <geographicflag>true</geographicflag>
        </spatialrefsys>
      </srs>
      <resourceMetadata>
        <identifier></identifier>
        <parentidentifier></parentidentifier>
        <language></language>
        <type>dataset</type>
        <title></title>
        <abstract></abstract>
        <links/>
        <dates/>
        <fees></fees>
        <encoding></encoding>
        <crs>
          <spatialrefsys nativeFormat="Wkt">
            <wkt></wkt>
            <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
            <srsid>0</srsid>
            <srid>0</srid>
            <authid></authid>
            <description></description>
            <projectionacronym></projectionacronym>
            <ellipsoidacronym></ellipsoidacronym>
            <geographicflag>false</geographicflag>
          </spatialrefsys>
        </crs>
        <extent/>
      </resourceMetadata>
      <provider encoding="UTF-8">ogr</provider>
      <vectorjoins/>
      <layerDependencies/>
      <dataDependencies/>
      <expressionfields/>
      <map-layer-style-manager current="default">
        <map-layer-style name="default"/>
      </map-layer-style-manager>
      <auxiliaryLayer/>
      <metadataUrls/>
      <flags>
        <Identifiable>1</Identifiable>
        <Removable>1</Removable>
        <Searchable>1</Searchable>
        <Private>0</Private>
      </flags>
      <renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" referencescale="-1" forceraster="0">
        <symbols>
          <symbol name="0" type="marker" force_rhr="0" alpha="1" is_animated="0" clip_to_extent="1" frame_rate="10">
            <data_defined_properties>
              <Option type="Map">
                <Option name="name" value="" type="QString"/>
                <Option name="properties"/>
                <Option name="type" value="collection" type="QString"/>
              </Option>
            </data_defined_properties>
            <layer class="SimpleMarker" enabled="1" id="0" locked="0" pass="0">
              <Option type="Map">
                <Option name="angle" value="0" type="QString"/>
                <Option name="cap_style" value="square" type="QString"/>
                <Option name="color" value="0,0,255,255,rgb:0,0,1,1" type="QString"/>
                <Option name="horizontal_anchor_point" value="1" type="QString"/>
                <Option name="joinstyle" value="bevel" type="QString"/>
                <Option name="name" value="circle" type="QString"/>
                <Option name="offset" value="0,0" type="QString"/>
                <Option name="offset_map_unit_scale" value="3x:0,0,0,0,0,0" type="QString"/>
                <Option name="offset_unit" value="MM" type="QString"/>
                <Option name="outline_color" value="35,35,35,255,rgb:0.13725490196078433,0.13725490196078433,0.13725490196078433,1" type="QString"/>
                <Option name="outline_style" value="solid" type="QString"/>
                <Option name="outline_width" value="0" type="QString"/>
                <Option name="outline_width_map_unit_scale" value="3x:0,0,0,0,0,0" type="QString"/>
                <Option name="outline_width_unit" value="MM" type="QString"/>
                <Option name="scale_method" value="diameter" type="QString"/>
                <Option name="size" value="3" type="QString"/>
                <Option name="size_map_unit_scale" value="3x:0,0,0,0,0,0" type="QString"/>
                <Option name="size_unit" value="MM" type="QString"/>
                <Option name="vertical_anchor_point" value="1" type="QString"/>
              </Option>
              <data_defined_properties>
                <Option type="Map">
                  <Option name="name" value="" type="QString"/>
                  <Option name="properties"/>
                  <Option name="type" value="collection" type="QString"/>
                </Option>
              </data_defined_properties>
            </layer>
          </symbol>
        </symbols>
        <rotation/>
        <sizescale/>
        <data-defined-properties>
          <Option type="Map">
            <Option name="name" value="" type="QString"/>
            <Option name="properties"/>
            <Option name="type" value="collection" type="QString"/>
          </Option>
        </data-defined-properties>
      </renderer-v2>
      <blendMode>0</blendMode>
      <featureBlendMode>0</featureBlendMode>
    </maplayer>
  </projectlayers>
  <layerorder>
    <layer id="{layer_id}"/>
  </layerorder>
  <properties>
    <Digitizing>
      <AvoidIntersectionsMode type="int">0</AvoidIntersectionsMode>
    </Digitizing>
    <Gui>
      <CanvasColorBluePart type="int">255</CanvasColorBluePart>
      <CanvasColorGreenPart type="int">255</CanvasColorGreenPart>
      <CanvasColorRedPart type="int">255</CanvasColorRedPart>
      <SelectionColorAlphaPart type="int">255</SelectionColorAlphaPart>
      <SelectionColorBluePart type="int">0</SelectionColorBluePart>
      <SelectionColorGreenPart type="int">255</SelectionColorGreenPart>
      <SelectionColorRedPart type="int">255</SelectionColorRedPart>
    </Gui>
    <Legend>
      <filterByMap type="bool">false</filterByMap>
    </Legend>
    <Measurement>
      <AreaUnits type="QString">m2</AreaUnits>
      <DistanceUnits type="QString">meters</DistanceUnits>
    </Measurement>
    <PAL>
      <CandidatesLinePerCM type="double">5</CandidatesLinePerCM>
      <CandidatesPolygonPerCM type="double">2.5</CandidatesPolygonPerCM>
      <DrawRectOnly type="bool">false</DrawRectOnly>
      <DrawUnplaced type="bool">false</DrawUnplaced>
      <PlacementEngineVersion type="int">1</PlacementEngineVersion>
      <SearchMethod type="int">0</SearchMethod>
      <ShowingAllLabels type="bool">false</ShowingAllLabels>
      <ShowingCandidates type="bool">false</ShowingCandidates>
      <ShowingPartialsLabels type="bool">true</ShowingPartialsLabels>
      <TextFormat type="int">0</TextFormat>
      <UnplacedColor type="QString">255,0,0,255,rgb:1,0,0,1</UnplacedColor>
    </PAL>
    <Paths>
      <Absolute type="bool">false</Absolute>
    </Paths>
    <PositionPrecision>
      <Automatic type="bool">true</Automatic>
      <DecimalPlaces type="int">2</DecimalPlaces>
    </PositionPrecision>
  </properties>
  <visibility-presets/>
  <transformContext/>
  <projectMetadata>
    <identifier></identifier>
    <parentidentifier></parentidentifier>
    <language></language>
    <type></type>
    <title></title>
    <abstract></abstract>
    <links/>
    <dates/>
    <author>FibreFlow</author>
    <creation>{now}</creation>
  </projectMetadata>
  <Annotations/>
  <Layouts/>
  <mapViewDocks/>
  <main-annotation-layer refreshOnNotifyEnabled="0" type="annotation" autoRefreshTime="0" autoRefreshMode="Disabled" refreshOnNotifyMessage="">
    <id>Sketches</id>
    <layername>sketches</layername>
    <srs>
      <spatialrefsys nativeFormat="Wkt">
        <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
        <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
        <srsid>3452</srsid>
        <srid>4326</srid>
        <authid>EPSG:4326</authid>
        <description>WGS 84</description>
        <projectionacronym>longlat</projectionacronym>
        <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
        <geographicflag>true</geographicflag>
      </spatialrefsys>
    </srs>
    <items/>
  </main-annotation-layer>
  <ProjectViewSettings rotation="0" UseProjectScales="0">
    <Scales/>
    <DefaultViewExtent ymin="{min_y}" xmax="{max_x}" ymax="{max_y}" xmin="{min_x}">
      <spatialrefsys nativeFormat="Wkt">
        <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],MEMBER["World Geodetic System 1984 (G2139)"],MEMBER["World Geodetic System 1984 (G2296)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
        <proj4>+proj=longlat +datum=WGS84 +no_defs</proj4>
        <srsid>3452</srsid>
        <srid>4326</srid>
        <authid>EPSG:4326</authid>
        <description>WGS 84</description>
        <projectionacronym>longlat</projectionacronym>
        <ellipsoidacronym>EPSG:7030</ellipsoidacronym>
        <geographicflag>true</geographicflag>
      </spatialrefsys>
    </DefaultViewExtent>
  </ProjectViewSettings>
  <ProjectStyleSettings DefaultSymbolOpacity="1" projectStyleId="sketches_sketches" RandomizeDefaultSymbolColor="true">
    <databases/>
  </ProjectStyleSettings>
  <ProjectTimeSettings frameRate="1" cumulativeTemporalRange="0" timeStepUnit="h" timeStep="1"/>
  <ElevationProperties>
    <terrainProvider type="flat">
      <TerrainProvider scale="1" offset="0"/>
    </terrainProvider>
  </ElevationProperties>
  <ProjectDisplaySettings CoordinateCustomCrs="" CoordinateType="MapCrs" CoordinateAxisOrder="Default">
    <BearingFormat id="bearing">
      <Option type="Map">
        <Option name="decimal_separator" type="invalid"/>
        <Option name="decimals" value="6" type="int"/>
        <Option name="direction_format" value="0" type="int"/>
        <Option name="rounding_type" value="0" type="int"/>
        <Option name="show_plus" value="false" type="bool"/>
        <Option name="show_thousand_separator" value="true" type="bool"/>
        <Option name="show_trailing_zeros" value="false" type="bool"/>
        <Option name="thousand_separator" type="invalid"/>
      </Option>
    </BearingFormat>
    <GeographicCoordinateFormat id="geographiccoordinate">
      <Option type="Map">
        <Option name="angle_format" value="0" type="int"/>
        <Option name="decimal_separator" type="invalid"/>
        <Option name="decimals" value="6" type="int"/>
        <Option name="rounding_type" value="0" type="int"/>
        <Option name="show_leading_degree_zeros" value="false" type="bool"/>
        <Option name="show_leading_zeros" value="false" type="bool"/>
        <Option name="show_plus" value="false" type="bool"/>
        <Option name="show_suffix" value="false" type="bool"/>
        <Option name="show_thousand_separator" value="true" type="bool"/>
        <Option name="show_trailing_zeros" value="false" type="bool"/>
        <Option name="thousand_separator" type="invalid"/>
      </Option>
    </GeographicCoordinateFormat>
    <CoordinateFormat id="coordinate">
      <Option type="Map">
        <Option name="decimal_separator" type="invalid"/>
        <Option name="decimals" value="6" type="int"/>
        <Option name="rounding_type" value="0" type="int"/>
        <Option name="show_plus" value="false" type="bool"/>
        <Option name="show_thousand_separator" value="true" type="bool"/>
        <Option name="show_trailing_zeros" value="false" type="bool"/>
        <Option name="thousand_separator" type="invalid"/>
      </Option>
    </CoordinateFormat>
  </ProjectDisplaySettings>
  <ProjectGpsSettings destinationFollowsActiveLayer="true" autoCommitFeatures="false" autoAddTrackVertices="false"/>
</qgis>'''

    with open(qgs_path, 'w') as f:
        f.write(qgs_content)

    logger.info(f"Created QGIS project: {qgs_path}")


def upload_to_qfieldcloud(upload_dir: str, upload_qgs: bool = True):
    """
    Upload files to QFieldCloud using SDK.

    CRITICAL: Must use qfieldcloud-sdk, NOT direct MinIO upload!
    CRITICAL: Must include wait times between uploads for storage sync!

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

    # CRITICAL: Wait for storage sync before uploading qgs
    logger.info("Waiting 10s for storage sync...")
    time.sleep(10)

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

        # CRITICAL: Wait for storage sync before triggering jobs
        logger.info("Waiting 10s for storage sync...")
        time.sleep(10)
    else:
        logger.info("Skipping QGIS project upload (UPLOAD_QGS=false)")

    # Trigger processing job and wait for completion
    logger.info("Triggering process_projectfile job...")
    job1 = client.job_trigger(QFIELD_PROJECT_ID, sdk.JobTypes.PROCESS_PROJECTFILE, force=True)
    job1_id = job1['id']
    logger.info(f"  Job ID: {job1_id}")

    # Wait for process_projectfile to complete
    logger.info("Waiting for process_projectfile to complete...")
    for i in range(30):  # Max 60 seconds
        time.sleep(2)
        status = client.job_status(job1_id)  # SDK only takes job_id
        job_status = status.get('status', 'unknown')
        logger.info(f"  Status: {job_status}")
        if job_status == 'finished':
            # Check layer validity
            feedback = status.get('feedback', {})
            steps = feedback.get('steps', [])
            for step in steps:
                if step.get('stage') == 'layer_validity':
                    outputs = step.get('outputs', [])
                    for out in outputs:
                        is_valid = out.get('is_valid', False)
                        layer_name = out.get('name', 'unknown')
                        error = out.get('error', '')
                        if is_valid:
                            logger.info(f"  ✅ Layer '{layer_name}' is valid")
                        else:
                            logger.error(f"  ❌ Layer '{layer_name}' invalid: {error}")
            break
        elif job_status == 'failed':
            logger.error(f"  ❌ process_projectfile failed!")
            feedback = status.get('feedback', {})
            logger.error(f"  Feedback: {feedback}")
            break
    else:
        logger.warning("  ⚠️ Timeout waiting for process_projectfile")

    # Trigger package job
    logger.info("Triggering package job...")
    job2 = client.job_trigger(QFIELD_PROJECT_ID, sdk.JobTypes.PACKAGE, force=True)
    job2_id = job2['id']
    logger.info(f"  Job ID: {job2_id}")

    # Wait for package to complete
    logger.info("Waiting for package job to complete...")
    for i in range(30):  # Max 60 seconds
        time.sleep(2)
        status = client.job_status(job2_id)  # SDK only takes job_id
        job_status = status.get('status', 'unknown')
        logger.info(f"  Status: {job_status}")
        if job_status == 'finished':
            logger.info("  ✅ Package job completed!")
            break
        elif job_status == 'failed':
            logger.error(f"  ❌ Package job failed!")
            break
    else:
        logger.warning("  ⚠️ Timeout waiting for package job")

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

        gpkg_filename = GPKG_FILENAME  # Use configured filename to match existing .qgs
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
