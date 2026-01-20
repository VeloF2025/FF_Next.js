#!/bin/bash

# Quick OES Sync - Just paste your token and run!
# Created: January 20, 2026

echo "================================================"
echo "Quick OES Sync to QFieldCloud"
echo "================================================"
echo ""
echo "Please paste your QFieldCloud API token:"
read -p "Token: " QFIELD_API_TOKEN

if [ -z "$QFIELD_API_TOKEN" ]; then
    echo "❌ No token provided. Exiting."
    exit 1
fi

echo ""
echo "Testing token..."

# Test the token
RESPONSE=$(curl -X GET "https://qfield.fibreflow.app/api/v1/auth/user/" \
  -H "Authorization: Token $QFIELD_API_TOKEN" \
  --insecure -s)

if echo "$RESPONSE" | grep -q "username"; then
    USERNAME=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('username', 'Unknown'))")
    echo "✅ Token valid! Logged in as: $USERNAME"
else
    echo "❌ Token invalid. Error: $RESPONSE"
    exit 1
fi

echo ""
echo "Updating configuration and running sync..."

# Update the token on the server
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105 << EOF
echo "VeloBoss@2026" | sudo -S bash -c "
# Update token in upload script
sed -i 's/QFIELD_API_TOKEN = .*/QFIELD_API_TOKEN = \"$QFIELD_API_TOKEN\"/' /home/louisdup/Agents/claude/VF/fibreflow-app/scripts/upload-oes-to-qfield.py 2>/dev/null

# Also update in sync config if it exists
if [ -f /opt/qfield-sync/config.env ]; then
    sed -i '/QFIELD_API_TOKEN=/d' /opt/qfield-sync/config.env
    echo 'QFIELD_API_TOKEN=$QFIELD_API_TOKEN' >> /opt/qfield-sync/config.env
fi
"
EOF

# Run the upload script
echo ""
echo "Uploading OES data to QFieldCloud..."
cd /home/louisdup/Agents/claude/VF/fibreflow-app

# Create a temporary version with the new token
cat > /tmp/upload-oes-temp.py << EOF
#!/usr/bin/env python3
import json
import requests
import psycopg2
import csv
import tempfile
import os
from datetime import datetime

# Configuration
QFIELD_API_URL = "https://qfield.fibreflow.app/api/v1"
QFIELD_API_TOKEN = "$QFIELD_API_TOKEN"
PROJECT_ID = "ad3b1035-ddb3-42a3-8077-175f9400b38a"  # OES_Project_Progress

# Neon database connection
NEON_DATABASE_URL = "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"

def fetch_oes_data():
    """Fetch OES data from Neon database."""
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

def create_csv_file(data):
    """Create CSV file with OES data."""
    temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False)

    writer = csv.writer(temp_file)
    # Write headers
    writer.writerow([
        'drop_number', 'activation_date', 'serial_number',
        'latitude', 'longitude', 'zone', 'pon', 'project_name',
        'ont_rx_sig_dbm', 'status', 'team'
    ])

    # Write data
    writer.writerows(data)
    temp_file.close()

    print(f"Created CSV file: {temp_file.name}")
    return temp_file.name

def upload_to_qfield(csv_file):
    """Upload CSV file to QFieldCloud project."""
    headers = {
        "Authorization": f"Token {QFIELD_API_TOKEN}",
        "Accept": "application/json"
    }

    # Check if project exists and is accessible
    project_url = f"{QFIELD_API_URL}/projects/{PROJECT_ID}/"
    response = requests.get(project_url, headers=headers, verify=False)

    if response.status_code == 200:
        print(f"✅ Project found: {response.json().get('name', 'Unknown')}")
    else:
        print(f"⚠️ Could not access project: {response.status_code}")
        print(response.text)
        return False

    # Upload file to project
    upload_url = f"{QFIELD_API_URL}/projects/{PROJECT_ID}/files/oes_activations.csv/"

    with open(csv_file, 'rb') as f:
        files = {'file': ('oes_activations.csv', f, 'text/csv')}

        # Try to upload (create or update)
        response = requests.post(upload_url, headers=headers, files=files, verify=False)

        if response.status_code in [200, 201]:
            print("✅ File uploaded successfully!")
            return True
        elif response.status_code == 409:
            # File exists, try to update it
            print("File exists, updating...")
            response = requests.patch(upload_url, headers=headers, files=files, verify=False)
            if response.status_code in [200, 201]:
                print("✅ File updated successfully!")
                return True

        print(f"❌ Upload failed: {response.status_code}")
        print(response.text)
        return False

# Main execution
try:
    # Fetch data
    data = fetch_oes_data()

    if not data:
        print("No data to upload")
    else:
        # Create CSV
        csv_file = create_csv_file(data)

        # Upload to QFieldCloud
        success = upload_to_qfield(csv_file)

        # Cleanup
        os.remove(csv_file)

        if success:
            print("\n✅ SUCCESS: OES data uploaded to QFieldCloud!")
            print(f"📍 {len(data)} drop locations now available in OES_Project_Progress")
            print("\n📱 Next steps for Jaun:")
            print("1. Open QField app")
            print("2. Sync OES_Project_Progress project")
            print("3. Enable 'oes_activations' layer")
            print("4. Drop numbers should be visible on map")
        else:
            print("\n❌ FAILED: Could not upload to QFieldCloud")

except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
EOF

# Run the upload
python3 /tmp/upload-oes-temp.py

echo ""
echo "================================================"
echo "Sync attempt complete!"
echo "Check output above for success/failure status."
echo "================================================"