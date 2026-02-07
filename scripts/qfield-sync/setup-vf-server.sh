#!/bin/bash
#
# Setup QField Sync on Velocity Server
# Run this script locally to deploy the sync infrastructure
#
# Usage: ./setup-vf-server.sh
#

set -e

VPS_HOST="100.96.203.105"
VPS_USER="velo"
VPS_PASS="$VELO_SSH_PASSWORD"
DEPLOY_DIR="/opt/qfield-sync"

echo "=============================================="
echo "Deploying QField Sync to Velocity Server"
echo "=============================================="

# Create deployment directory
echo "Creating deployment directory..."
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    sudo mkdir -p $DEPLOY_DIR
    sudo chown $VPS_USER:$VPS_USER $DEPLOY_DIR
"

# Copy files
echo "Copying sync scripts..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sshpass -p "$VPS_PASS" scp -r "$SCRIPT_DIR"/* "$VPS_USER@$VPS_HOST:$DEPLOY_DIR/"

# Install dependencies
echo "Installing Python dependencies..."
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    cd $DEPLOY_DIR
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
"

# Create log files
echo "Setting up log files..."
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    echo '$VPS_PASS' | sudo -S touch /var/log/qfield-sync.log
    echo '$VPS_PASS' | sudo -S touch /var/log/qfield-sync-server.log
    echo '$VPS_PASS' | sudo -S chown $VPS_USER:$VPS_USER /var/log/qfield-sync*.log
"

# Make scripts executable
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    chmod +x $DEPLOY_DIR/*.sh
    chmod +x $DEPLOY_DIR/*.py
"

# Create systemd service
echo "Creating systemd service..."
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    echo '$VPS_PASS' | sudo -S tee /etc/systemd/system/qfield-sync.service > /dev/null << 'EOF'
[Unit]
Description=QField Sync Webhook Server
After=network.target docker.service

[Service]
User=$VPS_USER
WorkingDirectory=$DEPLOY_DIR
Environment=NEON_DATABASE_URL=process.env.DATABASE_URL
Environment=QFIELD_DB_HOST=localhost
Environment=QFIELD_DB_PORT=5433
Environment=QFIELD_DB_NAME=qfieldcloud_db
Environment=QFIELD_DB_USER=qfieldcloud_db_admin
Environment=QFIELD_DB_PASSWORD=c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753
ExecStart=$DEPLOY_DIR/venv/bin/python3 $DEPLOY_DIR/sync_server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
"

# Enable and start service
echo "Enabling and starting service..."
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    echo '$VPS_PASS' | sudo -S systemctl daemon-reload
    echo '$VPS_PASS' | sudo -S systemctl enable qfield-sync.service
    echo '$VPS_PASS' | sudo -S systemctl restart qfield-sync.service
"

# Verify
echo "Verifying deployment..."
sleep 2
sshpass -p "$VPS_PASS" ssh "$VPS_USER@$VPS_HOST" "
    echo '$VPS_PASS' | sudo -S systemctl status qfield-sync.service --no-pager
"

# Test health endpoint
echo ""
echo "Testing health endpoint..."
curl -s "http://$VPS_HOST:8095/health" | python3 -m json.tool

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo "Service: qfield-sync.service"
echo "Port: 8095"
echo "Endpoints:"
echo "  - GET  http://$VPS_HOST:8095/health"
echo "  - GET  http://$VPS_HOST:8095/status"
echo "  - POST http://$VPS_HOST:8095/sync/oes"
echo "  - POST http://$VPS_HOST:8095/sync/full"
echo "=============================================="
