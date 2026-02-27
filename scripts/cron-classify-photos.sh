#!/bin/bash
# Cron job: ingest photos from QField + SharePoint, then classify via VLM
# Runs on Velocity where MinIO + VLM are local.
# Schedule: 4x daily (6am, 10am, 14pm, 18pm SAST)
#
# Crontab entry (add with: crontab -e):
#   0 6,10,14,18 * * * /home/velo/fibreflow-production/scripts/cron-classify-photos.sh >> /home/velo/logs/vlm-classify-cron.log 2>&1
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

# Cron secret for authenticated API calls
CRON_SECRET="${CRON_SECRET:-ad2bd65646c1e1242ade2bbcf0b0a684c3cce0c53f2684e8369d7bb9bc27a3d7}"

echo ""
echo "========================================"
echo "  QA Photo Sync Cron — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "========================================"

# Step 1: Ingest new QField photos (via FibreFlow API)
echo ""
echo "  [Step 1/4] Ingesting QField photos..."
QFIELD_RESULT=$(curl -sf -X POST 'http://localhost:3000/api/construction-qa/ingest-qfield' \
    -H 'Content-Type: application/json' \
    -H "x-cron-secret: ${CRON_SECRET}" \
    -d '{}' 2>&1) || echo "  WARNING: QField ingestion failed (continuing)"
echo "  QField result: ${QFIELD_RESULT:-'no response'}"

# Step 2: Ingest new SharePoint pole photos
echo ""
echo "  [Step 2/4] Ingesting SharePoint pole photos..."
$PYTHON "$INGEST_POLES" \
    --project all \
    --db-url "$DB_URL" || echo "  WARNING: Pole ingestion had errors (continuing)"

# Step 3: Ingest new SharePoint dome joint photos
echo ""
echo "  [Step 3/4] Ingesting SharePoint dome joint photos..."
$PYTHON "$INGEST_JOINTS" \
    --project all \
    --db-url "$DB_URL" || echo "  WARNING: Joint ingestion had errors (continuing)"

# Step 4: Classify up to 2000 new photos per run (both sources)
echo ""
echo "  [Step 4/4] Classifying unclassified photos via VLM..."
$PYTHON "$CLASSIFY" \
    --project all \
    --source all \
    --limit 2000 \
    --local-minio \
    --db-url "$DB_URL"

echo ""
echo "  Cron complete: $(date '+%H:%M:%S')"
echo "========================================"
