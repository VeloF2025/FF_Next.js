#!/bin/bash

# OES to QFieldCloud Sync - Quick Reference Script
# Created: January 20, 2026
# Purpose: Upload OES activation data to QFieldCloud for field teams

# ========================================
# CONFIGURATION (Update as needed)
# ========================================

# Known working credentials (as of Jan 20, 2026)
QFIELD_USERNAME="Adminuser"
QFIELD_PASSWORD="admin123"
QFIELD_TOKEN="a7XqW1AwhYU6fo81s7VI3JJRCnWRZoQmGoY2oY9vodiR59htA2rPQNXoSh1yIwgdYlNZezpEFz9l7zO5Bbx4AGPMm7dETJdB6u32"

# Project details
PROJECT_NAME="OES_Data_Jan2026"
PROJECT_ID="84de3884-4fb2-40bc-980d-2190405b057f"

# Database
NEON_DB="process.env.DATABASE_URL"

# ========================================
# FUNCTIONS
# ========================================

show_help() {
    cat << EOF
OES to QFieldCloud Sync Tool
============================

Usage: $0 [OPTION]

Options:
    -h, --help      Show this help message
    -t, --test      Test credentials and connection
    -u, --upload    Upload OES data to QFieldCloud
    -c, --check     Check how many OES records exist
    -n, --new       Create new project and upload
    -a, --add USER  Add USER as collaborator to project

Examples:
    $0 --test       # Test if credentials work
    $0 --check      # Check OES record count
    $0 --upload     # Upload to existing project
    $0 --add Jaun   # Add Jaun as collaborator

Current Configuration:
    Project: $PROJECT_NAME ($PROJECT_ID)
    User: $QFIELD_USERNAME

EOF
}

test_credentials() {
    echo "Testing QFieldCloud credentials..."
    RESPONSE=$(curl -s -X GET "https://qfield.fibreflow.app/api/v1/auth/user/" \
        -H "Authorization: Token $QFIELD_TOKEN" --insecure)

    if echo "$RESPONSE" | grep -q "username"; then
        echo "✅ Credentials valid!"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null | head -5
        return 0
    else
        echo "❌ Credentials invalid or expired"
        echo "Response: $RESPONSE"
        return 1
    fi
}

check_oes_count() {
    echo "Checking OES records in database..."
    python3 << EOF
import psycopg2

conn = psycopg2.connect("$NEON_DB")
cursor = conn.cursor()

# Count total records
cursor.execute("SELECT COUNT(*) FROM v_qfield_oes_activations WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
total = cursor.fetchone()[0]

# Count by status
cursor.execute("""
    SELECT status, COUNT(*)
    FROM v_qfield_oes_activations
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    GROUP BY status
""")
status_counts = cursor.fetchall()

print(f"✅ Total OES records with coordinates: {total}")
print("\nBreakdown by status:")
for status, count in status_counts:
    print(f"  - {status}: {count}")

cursor.close()
conn.close()
EOF
}

upload_oes_data() {
    echo "Uploading OES data to QFieldCloud..."
    echo "Project: $PROJECT_NAME"
    echo "ID: $PROJECT_ID"
    echo ""

    # Generate CSV
    python3 << EOF
import psycopg2
import csv
import requests

# Fetch data
conn = psycopg2.connect("$NEON_DB")
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

# Create CSV
csv_file = '/tmp/oes_activations.csv'
with open(csv_file, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow([
        'drop_number', 'activation_date', 'serial_number',
        'latitude', 'longitude', 'zone', 'pon', 'project_name',
        'ont_rx_sig_dbm', 'status', 'team'
    ])
    writer.writerows(data)

print(f"CSV created: {csv_file}")

# Upload to QFieldCloud
headers = {
    "Authorization": "Token $QFIELD_TOKEN",
}

with open(csv_file, 'rb') as f:
    files = {'file': ('oes_activations.csv', f, 'text/csv')}
    response = requests.post(
        "https://qfield.fibreflow.app/api/v1/files/$PROJECT_ID/oes_activations.csv/",
        headers=headers,
        files=files,
        verify=False
    )

if response.status_code in [200, 201]:
    print("✅ Upload successful!")
    print(f"📍 {len(data)} drops now available in QFieldCloud")
else:
    print(f"❌ Upload failed: {response.status_code}")
    print(response.text)
EOF
}

add_collaborator() {
    local username="$1"
    echo "Adding $username as collaborator to project..."

    RESPONSE=$(curl -s -X POST "https://qfield.fibreflow.app/api/v1/collaborators/$PROJECT_ID/" \
        -H "Authorization: Token $QFIELD_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"collaborator\": \"$username\", \"role\": \"admin\"}" \
        --insecure)

    if echo "$RESPONSE" | grep -q "collaborator"; then
        echo "✅ Successfully added $username as collaborator"
    else
        echo "❌ Failed to add collaborator"
        echo "$RESPONSE"
    fi
}

# ========================================
# MAIN
# ========================================

case "$1" in
    -h|--help)
        show_help
        ;;
    -t|--test)
        test_credentials
        ;;
    -c|--check)
        check_oes_count
        ;;
    -u|--upload)
        test_credentials && upload_oes_data
        ;;
    -a|--add)
        if [ -z "$2" ]; then
            echo "Error: Please specify username to add"
            echo "Usage: $0 --add USERNAME"
            exit 1
        fi
        add_collaborator "$2"
        ;;
    *)
        show_help
        ;;
esac