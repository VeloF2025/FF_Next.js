#!/bin/bash
# Cron job: ingest new SharePoint photos + classify via VLM
# Runs on Velocity where MinIO + VLM are local.
# Schedule: 3x daily (6am, 12pm, 6pm SAST)
#
# Crontab entry (add with: crontab -e):
#   0 6,12,18 * * * /home/velo/fibreflow-production/scripts/cron-classify-photos.sh >> /home/velo/logs/vlm-classify-cron.log 2>&1
#

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON="${SCRIPT_DIR}/../.venv/bin/python3"
INGEST_POLES="${SCRIPT_DIR}/ingest-sharepoint-qa.py"
INGEST_JOINTS="${SCRIPT_DIR}/ingest-sharepoint-joint-qa.py"
CLASSIFY="${SCRIPT_DIR}/classify-qa-photos-vlm.py"

# Use system python if no venv
if [ ! -f "$PYTHON" ]; then
    PYTHON="python3"
fi

# DB URL from environment or production default
DB_URL="${DATABASE_URL:-postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech:5432/neondb?sslmode=require}"

echo ""
echo "========================================"
echo "  QA Photo Sync Cron — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "========================================"

# Step 1: Ingest new SharePoint pole photos
echo ""
echo "  [Step 1/3] Ingesting SharePoint pole photos..."
$PYTHON "$INGEST_POLES" \
    --project all \
    --db-url "$DB_URL" || echo "  WARNING: Pole ingestion had errors (continuing)"

# Step 2: Ingest new SharePoint dome joint photos
echo ""
echo "  [Step 2/3] Ingesting SharePoint dome joint photos..."
$PYTHON "$INGEST_JOINTS" \
    --project all \
    --db-url "$DB_URL" || echo "  WARNING: Joint ingestion had errors (continuing)"

# Step 3: Classify up to 2000 new photos per run (both sources)
echo ""
echo "  [Step 3/3] Classifying unclassified photos via VLM..."
$PYTHON "$CLASSIFY" \
    --project all \
    --source all \
    --limit 2000 \
    --local-minio \
    --db-url "$DB_URL"

echo ""
echo "  Cron complete: $(date '+%H:%M:%S')"
echo "========================================"
