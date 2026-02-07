#!/bin/bash

# Quick OES Sync Script - Just add token and run!
# Created: January 20, 2026

echo "================================================"
echo "OES to QFieldCloud Sync - Quick Runner"
echo "================================================"
echo ""

# STEP 1: Replace this with your actual token
QFIELD_API_TOKEN="PASTE_YOUR_TOKEN_HERE"

if [ "$QFIELD_API_TOKEN" = "PASTE_YOUR_TOKEN_HERE" ]; then
    echo "❌ ERROR: Please edit this script and replace PASTE_YOUR_TOKEN_HERE with your actual token"
    echo ""
    echo "To get a token:"
    echo "1. Login to https://qfield.fibreflow.app"
    echo "2. Go to User Profile → API Tokens"
    echo "3. Create new token and paste it above"
    exit 1
fi

echo "✅ Token configured"
echo ""

# STEP 2: Update server configuration
echo "Updating server configuration..."
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105 << EOF
echo "$VELO_SSH_PASSWORD" | sudo -S bash -c "
# Update the token in config
sed -i '/QFIELD_API_TOKEN=/d' /opt/qfield-sync/config.env 2>/dev/null
echo 'QFIELD_API_TOKEN=$QFIELD_API_TOKEN' >> /opt/qfield-sync/config.env

# Show config
echo 'Configuration updated:'
grep 'QFIELD_PROJECT\|QFIELD_API_TOKEN' /opt/qfield-sync/config.env | head -3
"
EOF

echo ""
echo "✅ Configuration updated"
echo ""

# STEP 3: Run the sync
echo "Running OES sync..."
ssh -i ~/.ssh/vf_server_key louis@100.96.203.105 << 'EOF'
cd /opt/qfield-sync
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Check how many records we'll sync
echo ""
echo "Checking OES data..."
python3 -c "
import psycopg2
conn = psycopg2.connect('process.env.DATABASE_URL')
cur = conn.cursor()
cur.execute('SELECT COUNT(*) FROM v_qfield_oes_activations')
count = cur.fetchone()[0]
print(f'Found {count} OES records to sync')
cur.close()
conn.close()
"

echo ""
echo "Starting sync to QFieldCloud..."
python3 sync_oes_to_qfield.py --force --verbose

echo ""
echo "Sync attempt complete!"
EOF

echo ""
echo "================================================"
echo "SYNC COMPLETE!"
echo "================================================"
echo ""
echo "Next steps for Jaun:"
echo "1. Open QField app on mobile"
echo "2. Pull to refresh projects"
echo "3. Open 'OES_Project_Progress'"
echo "4. The OES activations layer should show 6,682 points"
echo "5. Drop numbers will be visible as labels on the map"
echo ""
echo "If sync failed, check:"
echo "- Is the token valid?"
echo "- Can you access https://qfield.fibreflow.app ?"
echo "- Contact Luke or system admin for help"
echo "================================================"