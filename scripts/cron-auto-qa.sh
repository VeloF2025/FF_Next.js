#!/usr/bin/env bash
# Auto-QA Pipeline cron — processes eligible DRs through automated QA phases 1-4
# Runs every 5 minutes against production.
#
# Schedule: */5 * * * * /home/hein/Workspace/FF_Next.js/scripts/cron-auto-qa.sh >> /tmp/auto-qa-cron.log 2>&1

set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
CRON_SECRET="ad2bd65646c1e1242ade2bbcf0b0a684c3cce0c53f2684e8369d7bb9bc27a3d7"
PROD_URL="http://localhost:3000"
DEV_URL="http://localhost:3005"
LIMIT=20

# Try production first, fall back to dev
URL="$PROD_URL"
if ! curl -sf "$PROD_URL/api/health" > /dev/null 2>&1; then
  URL="$DEV_URL"
  if ! curl -sf "$DEV_URL/api/health" > /dev/null 2>&1; then
    echo "$LOG_PREFIX ERROR: Neither production nor dev is responding"
    exit 1
  fi
fi

# Step 1: Retry failed/bad categorizations (re-trigger VLM for DRs that got Error results)
RETRY_RESPONSE=$(curl -sf -X POST "${URL}/api/cron/retry-categorizations?limit=10" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" 2>&1) || true

RETRY_SUMMARY=$(echo "$RETRY_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"retried={d['processed']} succeeded={d['succeeded']}\")" 2>/dev/null || echo "no retries")
echo "$LOG_PREFIX RETRY: ${URL} — ${RETRY_SUMMARY}"

# Step 2: Run auto-QA pipeline on eligible DRs
RESPONSE=$(curl -sf -X POST "${URL}/api/cron/auto-qa?limit=${LIMIT}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" 2>&1) || {
  echo "$LOG_PREFIX ERROR: Auto-QA cron request failed"
  exit 1
}

# Extract summary
PROCESSED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(f\"processed={d['processed']} succeeded={d['succeeded']} skipped={d['skipped']} failed={d['failed']}\")" 2>/dev/null || echo "parse error")

echo "$LOG_PREFIX OK: ${URL} — ${PROCESSED}"
