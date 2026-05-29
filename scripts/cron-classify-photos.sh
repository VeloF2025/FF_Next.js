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

# DB URL: prefer the process env, else read the deploy dir's env files.
# Cron runs with a minimal env (no DATABASE_URL), so it falls through to the
# files. Check both .env.local (dev) and .env (prod) — DATABASE_URL lives in a
# different file per environment. The previous hardcoded Neon fallback died at
# the 2026-04-18 Supabase cutover and silently failed this cron for weeks (auth
# errors against the dead neondb_owner); reading the env file keeps the URL in
# lockstep with the app and carries no stale credential in the repo.
if [ -z "${DATABASE_URL:-}" ]; then
    for env_file in "${SCRIPT_DIR}/../.env.local" "${SCRIPT_DIR}/../.env"; do
        if [ -f "$env_file" ]; then
            DATABASE_URL=$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"')
            [ -n "$DATABASE_URL" ] && break
        fi
    done
fi
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ]; then
    echo "  ERROR: DATABASE_URL not set and not found in ${SCRIPT_DIR}/../.env.local or ../.env — aborting"
    exit 1
fi

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
