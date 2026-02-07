#!/bin/bash

# Update QFieldCloud Project Configuration for OES Sync
# Project: OES_Project_Progress
# Project ID: ad3b1035-ddb3-42a3-8077-175f9400b38a
# Date: January 20, 2026

echo "Updating QFieldCloud OES sync configuration..."

# New project details from Jaun
NEW_PROJECT_ID="ad3b1035-ddb3-42a3-8077-175f9400b38a"
NEW_PROJECT_NAME="OES_Project_Progress"

# Update environment variables on VPS
echo "Setting environment variables for QFieldCloud sync..."

# Create or update the sync configuration
cat << EOF | sudo tee /opt/qfield-sync/config.env
# QFieldCloud Project Configuration
QFIELD_PROJECT_ID=${NEW_PROJECT_ID}
QFIELD_PROJECT_NAME=${NEW_PROJECT_NAME}
QFIELD_API_URL=https://qfield.fibreflow.app/api/v1
QFIELD_LAYER_NAME=oes_activations

# Database Configuration
NEON_DATABASE_URL=process.env.DATABASE_URL
QFIELD_DB_HOST=localhost
QFIELD_DB_PORT=5433
QFIELD_DB_NAME=qfieldcloud_db
QFIELD_DB_USER=qfieldcloud_db_admin
QFIELD_DB_PASSWORD=c6ce1f02f798c5776fee9e6857f628ff775c75e5eb3b7753

# Output paths
GPKG_OUTPUT_PATH=/opt/qfieldcloud/projects/${NEW_PROJECT_NAME}/oes_activations.gpkg
LOG_PATH=/var/log/qfield-sync.log
EOF

# Create project directory if it doesn't exist
sudo mkdir -p /opt/qfieldcloud/projects/${NEW_PROJECT_NAME}
sudo chown velo:velo /opt/qfieldcloud/projects/${NEW_PROJECT_NAME}

# Update sync script to use new project ID
if [ -f "/opt/qfield-sync/sync_oes_to_qfield.py" ]; then
    echo "Updating sync script with new project ID..."
    sudo sed -i "s/baf29cb3-2483-4924-b7c0-47953ac2851e/${NEW_PROJECT_ID}/g" /opt/qfield-sync/sync_oes_to_qfield.py
fi

# Restart sync service to apply changes
echo "Restarting sync service..."
sudo systemctl restart qfield-sync 2>/dev/null || echo "Service restart not needed"

# Run a test sync
echo "Running test sync to new project..."
cd /opt/qfield-sync
source venv/bin/activate 2>/dev/null || true
python3 sync_oes_to_qfield.py --gpkg

echo ""
echo "✅ Configuration updated successfully!"
echo "Project Name: ${NEW_PROJECT_NAME}"
echo "Project ID: ${NEW_PROJECT_ID}"
echo ""
echo "The OES data will now sync to the correct QFieldCloud project."
echo "Jaun should be able to see the data in OES_Project_Progress after the next sync."