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

# Load DATABASE_URL for the Python/psql steps. Try .env.local then .env: the two deploy
# dirs disagree about which one holds it — fibreflow-dev keeps DATABASE_URL in
# .env.local, fibreflow-production keeps it in .env — so an .env.local-only read made
# this script silently unusable from prod. It exported an EMPTY string and carried on,
# so every psql call failed with a confusing connection error instead of naming the
# real problem.
#
# UNREADABLE is reported separately from ABSENT: if an ACL change makes an env file
# unreadable to the cron user, "not found" would send someone hunting for a missing
# key that is actually right there.
DB_AVAILABLE=true
if [ -z "${DATABASE_URL:-}" ]; then
  for envfile in "$PROJECT_DIR/.env.local" "$PROJECT_DIR/.env"; do
    [ -e "$envfile" ] || continue
    if [ ! -r "$envfile" ]; then
      echo "$LOG_PREFIX WARNING: $envfile exists but is not readable by $(id -un)" >&2
      continue
    fi
    # Strip only WRAPPING quotes — `tr -d '"'` would silently mangle a password
    # containing a literal quote. `cut -f2-` keeps any '=' inside the value.
    val=$(grep -m1 '^DATABASE_URL=' "$envfile" | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/' || true)
    if [ -n "$val" ]; then
      export DATABASE_URL="$val"
      break
    fi
  done
fi
if [ -z "${DATABASE_URL:-}" ]; then
  # Do NOT exit. Steps 1 and 3 are curl calls against a running server that has its own
  # DB connection and never read this variable — aborting here would turn a config gap
  # into a full outage of an ingest path that would have succeeded. Skip only the steps
  # that genuinely need it, matching the per-step "FAILED — continuing" fault isolation
  # the rest of this script already uses.
  echo "$LOG_PREFIX ERROR: DATABASE_URL not found in $PROJECT_DIR/.env.local or .env — skipping DB-dependent steps (0, 2, 3-query)" >&2
  DB_AVAILABLE=false
fi

echo "$LOG_PREFIX === QA Ingest Cron Start ==="

# ── 0. GPKG Photo Extraction ─────────────────────────────────────────────────
# Extract photo references from QFieldCloud GPKGs into qfield_photo_validations
# with proper feature_id and checklist_step assignments from GPKG columns.
if [ "$DB_AVAILABLE" = true ]; then
  echo "$LOG_PREFIX [GPKG] Extracting photo references from GPKGs..."
  if python3 "$PROJECT_DIR/scripts/extract-gpkg-photos.py" --all 2>&1; then
    echo "$LOG_PREFIX [GPKG] Extraction complete"
  else
    echo "$LOG_PREFIX [GPKG] Extraction FAILED (exit $?) — continuing with ingestion"
  fi
else
  echo "$LOG_PREFIX [GPKG] SKIPPED — no DATABASE_URL"
fi

# ── 1. QField Ingest ──────────────────────────────────────────────────────────
echo "$LOG_PREFIX [QField] Ingesting all mapped projects..."
# `|| true` for the same reason PENDING_IDS has one below: under `set -e` a non-zero
# curl inside a command substitution aborts the WHOLE script, so a slow ingest silently
# takes the SharePoint and VLM steps with it. That is not hypothetical — the log shows
# 86 "Cron Start" against 84 "Cron Done". The server keeps working after curl gives up
# (Node does not abort on client disconnect), so the photos still land; only the rest of
# the cron is lost, with nothing naming the cause.
#
# 600s, not 120s: this call fans out over every mapped project and copies each new photo
# out of MinIO with a blocking `mc cat` at ~85 ms/object. A backlog of a few thousand
# photos is minutes of work, and 120s could not cover it.
QF_RESULT=$(curl -s -X POST "$PROD_URL/api/construction-qa/ingest-qfield" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}' \
  --max-time 600) || QF_RESULT='{"error":"curl failed or timed out — server may still be ingesting"}'
echo "$LOG_PREFIX [QField] Result: $QF_RESULT"

# ── 2. SharePoint Ingest ─────────────────────────────────────────────────────
SP_PROJECTS=("Lawley" "Mohadin" "Mamelodi" "Etwatwa" "Thembisa POP 1" "Thembisa POP 3")

if [ "$DB_AVAILABLE" = true ]; then
  for proj in "${SP_PROJECTS[@]}"; do
    echo "$LOG_PREFIX [SharePoint] Ingesting $proj..."
    if python3 "$PROJECT_DIR/scripts/ingest-sharepoint-qa.py" --project "$proj" 2>&1; then
      echo "$LOG_PREFIX [SharePoint] $proj complete"
    else
      echo "$LOG_PREFIX [SharePoint] $proj FAILED (exit $?)"
    fi
  done
else
  echo "$LOG_PREFIX [SharePoint] SKIPPED — no DATABASE_URL"
fi

# ── 3. VLM Validation ──────────────────────────────────────────────────────
# Process pending reviews through VLM (up to 20 per run)
echo "$LOG_PREFIX [VLM] Processing pending reviews..."
# The curl below needs review ids that only this query can supply, so no DATABASE_URL
# means nothing to validate — an empty list, not an error. `|| true` matters under
# `set -e`: a failing command substitution in an assignment aborts the whole script,
# which would skip the completion log and make the run look like it died mid-way.
PENDING_IDS=""
if [ "$DB_AVAILABLE" = true ]; then
  PENDING_IDS=$(psql "$DATABASE_URL" -t -A -c \
    "SELECT id || '|' || discipline FROM construction_qa_reviews WHERE vlm_status = 'pending' ORDER BY updated_at DESC LIMIT 20" 2>/dev/null || true)
else
  echo "$LOG_PREFIX [VLM] SKIPPED query — no DATABASE_URL"
fi

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
