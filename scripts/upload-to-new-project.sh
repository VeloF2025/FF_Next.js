#!/bin/bash

# Upload OES data to the newly created project
echo "================================================"
echo "Uploading OES Data to New QFieldCloud Project"
echo "================================================"
echo ""
echo "Project: OES_Data_Jan2026"
echo "Project ID: 84de3884-4fb2-40bc-980d-2190405b057f"
echo "User: Adminuser"
echo ""

# Generate CSV first
python3 << EOF
import psycopg2
import csv

# Connect to database
conn = psycopg2.connect(
    "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"
)
cursor = conn.cursor()

# Fetch OES data
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
with open('/tmp/oes_activations.csv', 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow([
        'drop_number', 'activation_date', 'serial_number',
        'latitude', 'longitude', 'zone', 'pon', 'project_name',
        'ont_rx_sig_dbm', 'status', 'team'
    ])
    writer.writerows(data)

print("CSV created at /tmp/oes_activations.csv")
EOF

echo ""
echo "Uploading CSV to QFieldCloud..."

# Upload using correct endpoint
curl -X POST "https://qfield.fibreflow.app/api/v1/files/84de3884-4fb2-40bc-980d-2190405b057f/oes_activations.csv/" \
  -H "Authorization: Token a7XqW1AwhYU6fo81s7VI3JJRCnWRZoQmGoY2oY9vodiR59htA2rPQNXoSh1yIwgdYlNZezpEFz9l7zO5Bbx4AGPMm7dETJdB6u32" \
  -F "file=@/tmp/oes_activations.csv" \
  --insecure -s | python3 -m json.tool 2>/dev/null

echo ""
echo "================================================"
echo "Upload complete! Check response above."
echo ""
echo "Tell Jaun:"
echo "1. New project created: OES_Data_Jan2026"
echo "2. Open in QField app and sync"
echo "3. All 6,682 OES drops should be visible"
echo "================================================"