#!/usr/bin/env bash
# Automated Construction QA photo ingestion (runs on Velocity production)
# - QField: calls production API to ingest from qfield_photo_validations
# - SharePoint: runs Python script for each project
#
# Schedule: daily at 05:00 SAST (03:00 UTC)
# Crontab:  0 3 * * * /home/hein/Workspace/FF_Next.js/scripts/cron-qa-ingest.sh >> /tmp/qa-ingest-cron.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

CRON_SECRET="ad2bd65646c1e1242ade2bbcf0b0a684c3cce0c53f2684e8369d7bb9bc27a3d7"
PROD_URL="http://localhost:3000"

# Load DATABASE_URL from .env.local for the SharePoint Python script
if [ -f "$PROJECT_DIR/.env.local" ]; then
  export DATABASE_URL=$(grep '^DATABASE_URL=' "$PROJECT_DIR/.env.local" | cut -d= -f2-)
fi

echo "$LOG_PREFIX === QA Ingest Cron Start ==="

# ── 0. GPKG Photo Extraction ─────────────────────────────────────────────────
# Extract photo references from QFieldCloud GPKGs into qfield_photo_validations
# with proper feature_id and checklist_step assignments from GPKG columns.
echo "$LOG_PREFIX [GPKG] Extracting photo references from GPKGs..."
if python3 "$PROJECT_DIR/scripts/extract-gpkg-photos.py" --all 2>&1; then
  echo "$LOG_PREFIX [GPKG] Extraction complete"
else
  echo "$LOG_PREFIX [GPKG] Extraction FAILED (exit $?) — continuing with ingestion"
fi

# ── 1. QField Ingest ──────────────────────────────────────────────────────────
echo "$LOG_PREFIX [QField] Ingesting all mapped projects..."
QF_RESULT=$(curl -s -X POST "$PROD_URL/api/construction-qa/ingest-qfield" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}' \
  --max-time 120)
echo "$LOG_PREFIX [QField] Result: $QF_RESULT"

# ── 2. SharePoint Ingest ─────────────────────────────────────────────────────
SP_PROJECTS=("Lawley" "Mohadin" "Mamelodi" "Etwatwa" "Thembisa POP 1" "Thembisa POP 3")

for proj in "${SP_PROJECTS[@]}"; do
  echo "$LOG_PREFIX [SharePoint] Ingesting $proj..."
  if python3 "$PROJECT_DIR/scripts/ingest-sharepoint-qa.py" --project "$proj" 2>&1; then
    echo "$LOG_PREFIX [SharePoint] $proj complete"
  else
    echo "$LOG_PREFIX [SharePoint] $proj FAILED (exit $?)"
  fi
done

# ── 3. VLM Validation ──────────────────────────────────────────────────────
# Process pending reviews through VLM (up to 20 per run)
echo "$LOG_PREFIX [VLM] Processing pending reviews..."
PENDING_IDS=$(psql "$DATABASE_URL" -t -A -c \
  "SELECT id || '|' || discipline FROM construction_qa_reviews WHERE vlm_status = 'pending' ORDER BY updated_at DESC LIMIT 20" 2>/dev/null)

VLM_COUNT=0
for entry in $PENDING_IDS; do
  RID=$(echo "$entry" | cut -d'|' -f1)
  DISC=$(echo "$entry" | cut -d'|' -f2)
  VLM_RESULT=$(curl -s -X POST "$PROD_URL/api/construction-qa/vlm-validate" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: $CRON_SECRET" \
    -d "{\"reviewId\": \"$RID\", \"discipline\": \"$DISC\", \"forceRerun\": true}" \
    --max-time 60 2>/dev/null) || true
  VLM_COUNT=$((VLM_COUNT + 1))
done
echo "$LOG_PREFIX [VLM] Processed $VLM_COUNT reviews"

echo "$LOG_PREFIX === QA Ingest Cron Done ==="
