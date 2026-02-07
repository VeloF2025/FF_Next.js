#!/usr/bin/env python3
"""
Create OES GeoPackage for QFieldCloud
A GeoPackage (.gpkg) will display properly as a layer in QField
"""

import psycopg2
import requests
import json
from datetime import datetime

# Configuration
QFIELD_API_URL = "https://qfield.fibreflow.app/api/v1"
QFIELD_API_TOKEN = "a7XqW1AwhYU6fo81s7VI3JJRCnWRZoQmGoY2oY9vodiR59htA2rPQNXoSh1yIwgdYlNZezpEFz9l7zO5Bbx4AGPMm7dETJdB6u32"
PROJECT_ID = "84de3884-4fb2-40bc-980d-2190405b057f"  # OES_Data_Jan2026

# Neon database
NEON_DATABASE_URL = "process.env.DATABASE_URL"

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

def create_geojson(data):
    """Create GeoJSON from OES data"""
    features = []

    for row in data:
        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row[4]), float(row[3])]  # [longitude, latitude]
            },
            "properties": {
                "drop_number": row[0],
                "activation_date": row[1],
                "serial_number": row[2],
                "zone": row[5],
                "pon": row[6],
                "project_name": row[7],
                "ont_rx_sig_dbm": float(row[8]) if row[8] else -40,
                "status": row[9],
                "team": row[10]
            }
        }
        features.append(feature)

    geojson = {
        "type": "FeatureCollection",
        "name": "OES_Activations",
        "crs": {
            "type": "name",
            "properties": {
                "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
            }
        },
        "features": features
    }

    return geojson

def upload_geojson(geojson):
    """Upload GeoJSON to QFieldCloud"""
    headers = {
        "Authorization": f"Token {QFIELD_API_TOKEN}",
        "Content-Type": "application/json"
    }

    # Save as GeoJSON file
    geojson_str = json.dumps(geojson, indent=2)

    # Upload as GeoJSON
    print("Uploading GeoJSON to QFieldCloud...")

    files = {
        'file': ('oes_activations.geojson', geojson_str, 'application/geo+json')
    }

    response = requests.post(
        f"{QFIELD_API_URL}/files/{PROJECT_ID}/oes_activations.geojson/",
        headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
        files=files,
        verify=False
    )

    if response.status_code in [200, 201]:
        print("✅ GeoJSON uploaded successfully!")
        return True
    elif response.status_code == 409:
        print("File exists, updating...")
        # Try PATCH for update
        response = requests.patch(
            f"{QFIELD_API_URL}/files/{PROJECT_ID}/oes_activations.geojson/",
            headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
            files=files,
            verify=False
        )
        if response.status_code in [200, 201]:
            print("✅ GeoJSON updated successfully!")
            return True

    print(f"❌ Upload failed: {response.status_code}")
    print(response.text)
    return False

def create_qgis_project():
    """Create a simple QGIS project file that references the GeoJSON"""

    # Minimal QGIS project that loads the GeoJSON
    qgs_content = f"""<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="OES_Data_Jan2026" version="3.28.0-Firenze">
  <title>OES Activations</title>
  <autotransaction active="0"/>
  <evaluateDefaultValues active="0"/>
  <trust active="0"/>
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
    <layer-tree-layer expanded="1" checked="Qt::Checked" id="oes_activations" name="OES Activations">
      <customproperties/>
    </layer-tree-layer>
  </layer-tree-group>
  <maplayers>
    <maplayer type="vector" geometry="Point" labelsEnabled="1" simplifyDrawingHints="0">
      <id>oes_activations</id>
      <datasource>./oes_activations.geojson</datasource>
      <layername>OES Activations</layername>
      <provider encoding="UTF-8">ogr</provider>
      <labeling type="simple">
        <settings calloutType="simple">
          <text-style fieldName="drop_number" fontSize="10"/>
          <placement dist="0" distUnits="MM" placement="0"/>
        </settings>
      </labeling>
    </maplayer>
  </maplayers>
</qgis>"""

    return qgs_content

def upload_project_file():
    """Upload QGIS project file"""
    qgs_content = create_qgis_project()

    files = {
        'file': ('oes_project.qgs', qgs_content, 'application/xml')
    }

    response = requests.post(
        f"{QFIELD_API_URL}/files/{PROJECT_ID}/oes_project.qgs/",
        headers={"Authorization": f"Token {QFIELD_API_TOKEN}"},
        files=files,
        verify=False
    )

    if response.status_code in [200, 201]:
        print("✅ QGIS project file uploaded!")
        return True

    print(f"❌ Project upload failed: {response.status_code}")
    return False

def main():
    print("="*60)
    print("Creating GeoJSON for QFieldCloud")
    print(f"Project: OES_Data_Jan2026")
    print(f"Time: {datetime.now()}")
    print("="*60)

    # Fetch data
    data = fetch_oes_data()

    if not data:
        print("No data to process")
        return

    # Create and upload GeoJSON
    geojson = create_geojson(data)

    # Save locally for debugging
    with open('/tmp/oes_activations.geojson', 'w') as f:
        json.dump(geojson, f, indent=2)
    print(f"Saved locally: /tmp/oes_activations.geojson")

    # Upload to QFieldCloud
    if upload_geojson(geojson):
        print("\nUploading QGIS project file...")
        upload_project_file()

        print("\n" + "="*60)
        print("✅ SUCCESS!")
        print("="*60)
        print(f"Files uploaded:")
        print("  - oes_activations.geojson (point layer)")
        print("  - oes_project.qgs (QGIS project)")
        print(f"\n📱 Tell Jaun:")
        print("1. Delete local project cache")
        print("2. Download project fresh")
        print("3. Open 'oes_project.qgs'")
        print("4. The OES Activations layer should appear")
        print("5. Drop numbers will show as labels")
    else:
        print("\n❌ Failed to upload GeoJSON")

if __name__ == "__main__":
    main()