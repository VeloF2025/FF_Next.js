#!/usr/bin/env python3
"""
Create OES GeoPackage for QFieldCloud
GeoPackage is the preferred format for QField mobile app
"""

import psycopg2
import requests
import sqlite3
import os
from datetime import datetime

# Configuration
QFIELD_API_URL = "https://qfield.fibreflow.app/api/v1"
QFIELD_API_TOKEN = "a7XqW1AwhYU6fo81s7VI3JJRCnWRZoQmGoY2oY9vodiR59htA2rPQNXoSh1yIwgdYlNZezpEFz9l7zO5Bbx4AGPMm7dETJdB6u32"
PROJECT_ID = "84de3884-4fb2-40bc-980d-2190405b057f"  # OES_Data_Jan2026

# Neon database
NEON_DATABASE_URL = "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"

def fetch_oes_data():
    """Fetch OES data from database"""
    print("Fetching OES data from database...")
    conn = psycopg2.connect(NEON_DATABASE_URL)
    cursor = conn.cursor()

    query = """
    SELECT
        drop_number,
        activation_date::text,
        serial_number,
        latitude,
        longitude,
        COALESCE(zone, 'Unknown') as zone,
        COALESCE(pon, 'Unknown') as pon,
        COALESCE(project_name, 'Unknown') as project_name,
        ont_rx_sig_dbm,
        status,
        team
    FROM v_qfield_oes_activations
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND latitude != 0
      AND longitude != 0
    ORDER BY drop_number
    """

    cursor.execute(query)
    data = cursor.fetchall()
    cursor.close()
    conn.close()

    print(f"Fetched {len(data)} records")
    return data

def create_geopackage_with_ogr(data):
    """Create GeoPackage using ogr2ogr command"""
    import subprocess
    import csv
    import tempfile

    # Create CSV first
    csv_file = '/tmp/oes_temp.csv'
    with open(csv_file, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            'drop_number', 'activation_date', 'serial_number',
            'latitude', 'longitude', 'zone', 'pon', 'project_name',
            'ont_rx_sig_dbm', 'status', 'team'
        ])
        writer.writerows(data)

    print(f"Created temporary CSV: {csv_file}")

    # Create VRT file for ogr2ogr
    vrt_content = f"""<OGRVRTDataSource>
    <OGRVRTLayer name="oes_activations">
        <SrcDataSource>{csv_file}</SrcDataSource>
        <GeometryType>wkbPoint</GeometryType>
        <LayerSRS>WGS84</LayerSRS>
        <GeometryField encoding="PointFromColumns" x="longitude" y="latitude"/>
        <Field name="drop_number" type="String"/>
        <Field name="activation_date" type="String"/>
        <Field name="serial_number" type="String"/>
        <Field name="latitude" type="Real"/>
        <Field name="longitude" type="Real"/>
        <Field name="zone" type="String"/>
        <Field name="pon" type="String"/>
        <Field name="project_name" type="String"/>
        <Field name="ont_rx_sig_dbm" type="Real"/>
        <Field name="status" type="String"/>
        <Field name="team" type="String"/>
    </OGRVRTLayer>
</OGRVRTDataSource>"""

    vrt_file = '/tmp/oes_temp.vrt'
    with open(vrt_file, 'w') as f:
        f.write(vrt_content)

    print(f"Created VRT file: {vrt_file}")

    # Create GeoPackage using ogr2ogr
    gpkg_file = '/tmp/oes_activations.gpkg'

    # Remove existing file if it exists
    if os.path.exists(gpkg_file):
        os.remove(gpkg_file)

    try:
        cmd = [
            'ogr2ogr',
            '-f', 'GPKG',
            gpkg_file,
            vrt_file,
            '-nln', 'oes_activations',
            '-a_srs', 'EPSG:4326'
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode == 0:
            print(f"✅ GeoPackage created: {gpkg_file}")
            return gpkg_file
        else:
            print(f"❌ ogr2ogr failed: {result.stderr}")
            print("Falling back to manual creation...")
            return None
    except FileNotFoundError:
        print("ogr2ogr not found. Trying manual creation...")
        return None

def create_geopackage_manual(data):
    """Create GeoPackage manually using sqlite3"""
    gpkg_file = '/tmp/oes_activations.gpkg'

    # Remove existing file
    if os.path.exists(gpkg_file):
        os.remove(gpkg_file)

    conn = sqlite3.connect(gpkg_file)
    cursor = conn.cursor()

    # Create GeoPackage tables
    cursor.executescript("""
    CREATE TABLE gpkg_contents (
        table_name TEXT NOT NULL PRIMARY KEY,
        data_type TEXT NOT NULL,
        identifier TEXT UNIQUE,
        description TEXT DEFAULT '',
        last_change DATETIME NOT NULL DEFAULT (datetime('now','utc')),
        min_x DOUBLE,
        min_y DOUBLE,
        max_x DOUBLE,
        max_y DOUBLE,
        srs_id INTEGER
    );

    CREATE TABLE gpkg_spatial_ref_sys (
        srs_name TEXT NOT NULL,
        srs_id INTEGER NOT NULL PRIMARY KEY,
        organization TEXT NOT NULL,
        organization_coordsys_id INTEGER NOT NULL,
        definition TEXT NOT NULL,
        description TEXT
    );

    INSERT INTO gpkg_spatial_ref_sys VALUES
    ('WGS 84', 4326, 'EPSG', 4326,
     'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
     'WGS 84');

    CREATE TABLE oes_activations (
        fid INTEGER PRIMARY KEY AUTOINCREMENT,
        geom BLOB,
        drop_number TEXT,
        activation_date TEXT,
        serial_number TEXT,
        zone TEXT,
        pon TEXT,
        project_name TEXT,
        ont_rx_sig_dbm REAL,
        status TEXT,
        team TEXT
    );

    INSERT INTO gpkg_contents VALUES
    ('oes_activations', 'features', 'oes_activations', 'OES Activation Points',
     datetime('now','utc'), -180, -90, 180, 90, 4326);
    """)

    # Insert data
    for row in data:
        # Create WKB point geometry (simplified)
        lon, lat = float(row[4]), float(row[3])

        # Simple WKB point (little-endian)
        import struct
        wkb = struct.pack('<B', 1)  # Little-endian
        wkb += struct.pack('<I', 1)  # Point type
        wkb += struct.pack('<dd', lon, lat)  # Coordinates

        cursor.execute("""
            INSERT INTO oes_activations
            (geom, drop_number, activation_date, serial_number, zone, pon,
             project_name, ont_rx_sig_dbm, status, team)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (wkb, row[0], row[1], row[2], row[5], row[6],
              row[7], float(row[8]) if row[8] else -40, row[9], row[10]))

    conn.commit()
    conn.close()

    print(f"✅ GeoPackage created manually: {gpkg_file}")
    return gpkg_file

def upload_geopackage(gpkg_file):
    """Upload GeoPackage to QFieldCloud"""
    print("Uploading GeoPackage to QFieldCloud...")

    with open(gpkg_file, 'rb') as f:
        files = {'file': ('oes_activations.gpkg', f, 'application/geopackage+sqlite3')}

        response = requests.post(
            f"{QFIELD_API_URL}/files/{PROJECT_ID}/oes_activations.gpkg/",
            headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
            files=files,
            verify=False
        )

        if response.status_code in [200, 201]:
            print("✅ GeoPackage uploaded successfully!")
            return True
        elif response.status_code == 409:
            print("File exists, updating...")
            # Try PATCH
            response = requests.patch(
                f"{QFIELD_API_URL}/files/{PROJECT_ID}/oes_activations.gpkg/",
                headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
                files=files,
                verify=False
            )
            if response.status_code in [200, 201]:
                print("✅ GeoPackage updated!")
                return True

        print(f"❌ Upload failed: {response.status_code}")
        print(response.text)
        return False

def create_qgis_project_for_gpkg():
    """Create QGIS project file for GeoPackage"""
    qgs_content = """<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="OES_Data_Jan2026" version="3.28.0">
  <title>OES Activations</title>
  <projectCrs>
    <spatialrefsys nativeFormat="Wkt">
      <wkt>GEOGCRS["WGS 84",ENSEMBLE["World Geodetic System 1984 ensemble",MEMBER["World Geodetic System 1984 (Transit)"],MEMBER["World Geodetic System 1984 (G730)"],MEMBER["World Geodetic System 1984 (G873)"],MEMBER["World Geodetic System 1984 (G1150)"],MEMBER["World Geodetic System 1984 (G1674)"],MEMBER["World Geodetic System 1984 (G1762)"],ELLIPSOID["WGS 84",6378137,298.257223563,LENGTHUNIT["metre",1]],ENSEMBLEACCURACY[2.0]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]],CS[ellipsoidal,2],AXIS["geodetic latitude (Lat)",north,ORDER[1],ANGLEUNIT["degree",0.0174532925199433]],AXIS["geodetic longitude (Lon)",east,ORDER[2],ANGLEUNIT["degree",0.0174532925199433]],USAGE[SCOPE["Horizontal component of 3D system."],AREA["World."],BBOX[-90,-180,90,180]],ID["EPSG",4326]]</wkt>
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
    <customproperties/>
    <layer-tree-layer expanded="1" checked="Qt::Checked" id="oes_layer" name="OES Activations">
      <customproperties/>
    </layer-tree-layer>
  </layer-tree-group>
  <maplayers>
    <maplayer type="vector" geometry="Point" labelsEnabled="1">
      <id>oes_layer</id>
      <datasource>./oes_activations.gpkg|layername=oes_activations</datasource>
      <layername>OES Activations</layername>
      <provider encoding="UTF-8">ogr</provider>
      <labeling type="simple">
        <settings calloutType="simple">
          <text-style fieldName="drop_number" fontSize="10">
            <text-color red="0" green="0" blue="0" alpha="255"/>
            <text-buffer bufferDraw="1" bufferSize="1">
              <buffer-color red="255" green="255" blue="255" alpha="255"/>
            </text-buffer>
          </text-style>
          <placement dist="0" distUnits="MM" placement="0"/>
        </settings>
      </labeling>
      <renderer-v2 type="singleSymbol" symbollevels="0">
        <symbols>
          <symbol type="marker" name="0">
            <layer class="SimpleMarker">
              <prop k="color" v="255,0,0,255"/>
              <prop k="size" v="2"/>
              <prop k="outline_color" v="0,0,0,255"/>
              <prop k="outline_width" v="0.5"/>
            </layer>
          </symbol>
        </symbols>
      </renderer-v2>
    </maplayer>
  </maplayers>
</qgis>"""

    return qgs_content

def upload_qgis_project():
    """Upload QGIS project for GeoPackage"""
    qgs_content = create_qgis_project_for_gpkg()

    files = {'file': ('OES_Project.qgs', qgs_content, 'application/xml')}

    response = requests.post(
        f"{QFIELD_API_URL}/files/{PROJECT_ID}/OES_Project.qgs/",
        headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
        files=files,
        verify=False
    )

    if response.status_code in [200, 201]:
        print("✅ QGIS project uploaded!")
        return True

    print(f"❌ Project upload failed: {response.status_code}")
    return False

def main():
    print("="*60)
    print("Creating OES GeoPackage for QFieldCloud")
    print("Project: OES_Data_Jan2026")
    print(f"Time: {datetime.now()}")
    print("="*60)

    # Fetch data
    data = fetch_oes_data()

    if not data:
        print("No data to process")
        return

    # Try to create GeoPackage with ogr2ogr first
    gpkg_file = create_geopackage_with_ogr(data)

    if not gpkg_file:
        # Fallback to manual creation
        gpkg_file = create_geopackage_manual(data)

    if gpkg_file and os.path.exists(gpkg_file):
        # Get file size
        size = os.path.getsize(gpkg_file)
        print(f"GeoPackage size: {size:,} bytes")

        # Upload to QFieldCloud
        if upload_geopackage(gpkg_file):
            print("\nUploading QGIS project...")
            upload_qgis_project()

            print("\n" + "="*60)
            print("✅ SUCCESS! GeoPackage uploaded!")
            print("="*60)
            print("\n📱 Tell Jaun:")
            print("1. Delete local project cache completely")
            print("2. Download project fresh")
            print("3. Open 'OES_Project.qgs' (NOT oes_project.qgs)")
            print("4. The OES Activations layer should show")
            print("5. Drop numbers will display as labels")
            print("\nFiles in project:")
            print("  - oes_activations.gpkg (GeoPackage data)")
            print("  - OES_Project.qgs (QGIS project file)")
    else:
        print("❌ Failed to create GeoPackage")

if __name__ == "__main__":
    main()