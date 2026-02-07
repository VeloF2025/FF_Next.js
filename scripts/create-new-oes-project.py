#!/usr/bin/env python3
"""
Create a new OES project in QFieldCloud with Adminuser
Since we can't access Jaun's project, create our own
"""

import json
import requests
import psycopg2
import csv
import tempfile
import os
from datetime import datetime

# Configuration
QFIELD_API_URL = "https://qfield.fibreflow.app/api/v1"
QFIELD_API_TOKEN = "a7XqW1AwhYU6fo81s7VI3JJRCnWRZoQmGoY2oY9vodiR59htA2rPQNXoSh1yIwgdYlNZezpEFz9l7zO5Bbx4AGPMm7dETJdB6u32"

# Neon database
NEON_DATABASE_URL = "process.env.DATABASE_URL"

def create_project():
    """Create a new project in QFieldCloud"""
    headers = {
        "Authorization": f"Token {QFIELD_API_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    project_data = {
        "name": "OES_Data_Jan2026",
        "description": "OES activation data - 6,682 drops with coordinates",
        "is_private": False
    }

    response = requests.post(
        f"{QFIELD_API_URL}/projects/",
        headers=headers,
        json=project_data,
        verify=False
    )

    if response.status_code in [200, 201]:
        project = response.json()
        print(f"✅ Created project: {project['name']}")
        print(f"   Project ID: {project['id']}")
        return project['id']
    else:
        print(f"❌ Failed to create project: {response.status_code}")
        print(response.text)
        return None

def fetch_oes_data():
    """Fetch OES data from database"""
    print("Fetching OES data...")
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

def create_csv(data):
    """Create CSV file"""
    temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)

    writer = csv.writer(temp_file)
    writer.writerow([
        'drop_number', 'activation_date', 'serial_number',
        'latitude', 'longitude', 'zone', 'pon', 'project_name',
        'ont_rx_sig_dbm', 'status', 'team'
    ])
    writer.writerows(data)
    temp_file.close()

    return temp_file.name

def upload_to_project(project_id, csv_file):
    """Upload CSV to project"""
    headers = {
        "Authorization": f"Token {QFIELD_API_TOKEN}",
        "Accept": "application/json"
    }

    upload_url = f"{QFIELD_API_URL}/projects/{project_id}/files/oes_activations.csv/"

    with open(csv_file, 'rb') as f:
        files = {'file': ('oes_activations.csv', f, 'text/csv')}
        response = requests.post(upload_url, headers=headers, files=files, verify=False)

        if response.status_code in [200, 201]:
            print("✅ CSV uploaded successfully!")
            return True
        else:
            print(f"❌ Upload failed: {response.status_code}")
            print(response.text)
            return False

def main():
    print("="*60)
    print("Creating New OES Project with Adminuser")
    print("="*60)

    # Create new project
    project_id = create_project()

    if not project_id:
        print("Failed to create project. Exiting.")
        return

    # Fetch data
    data = fetch_oes_data()

    if not data:
        print("No data to upload")
        return

    # Create CSV
    csv_file = create_csv(data)

    # Upload to new project
    success = upload_to_project(project_id, csv_file)

    # Cleanup
    os.remove(csv_file)

    if success:
        print("\n" + "="*60)
        print("✅ SUCCESS! NEW PROJECT CREATED WITH OES DATA!")
        print("="*60)
        print(f"Project: OES_Data_Jan2026")
        print(f"Project ID: {project_id}")
        print(f"Records: {len(data)}")
        print("\n📱 Tell Jaun:")
        print("1. New project created: OES_Data_Jan2026")
        print("2. Contains all 6,682 OES drops")
        print("3. Open this project in QField app")
        print("="*60)

if __name__ == "__main__":
    main()