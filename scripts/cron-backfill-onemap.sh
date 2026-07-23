#!/usr/bin/env bash
# Backfill OneMap photo/serial data for DRs whose 1Map ingest was incomplete.
#
# Schedule: */15 * * * * /home/hein/Workspace/FF_Next.js/scripts/cron-backfill-onemap.sh >> /tmp/backfill-onemap-cron.log 2>&1
#
# Why this exists: /api/cron/backfill-onemap-data was only ever listed in
# vercel.json, and this app deploys to systemd on Velocity — so it had no
# scheduler at all. The 2026-07-23 1Map slowdown left DRs holding a partial
# photo set with nobody to repair them.
#
# mode=unverified targets photo sets never checked against 1Map, or checked and
# found short. The zero-photo case is separately covered by
# refetch-missing-photos (called from cron-auto-qa.sh).

set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
PROD_URL="http://localhost:3000"
DEV_URL="http://localhost:3005"
ENV_FILE="${FF_ENV_FILE:-/home/velo/fibreflow-production/.env.local}"
LIMIT="${LIMIT:-20}"

# Never hardcode the secret — read it from the deploy env (CLAUDE.md rule 11).
if [[ ! -r "$ENV_FILE" ]]; then
  echo "$LOG_PREFIX ERROR: cannot read $ENV_FILE for CRON_SECRET"
  exit 1
fi
CRON_SECRET="$(sed -n 's/^CRON_SECRET=//p' "$ENV_FILE" | head -1 | tr -d '"'"'"'')"
if [[ -z "$CRON_SECRET" ]]; then
  echo "$LOG_PREFIX ERROR: CRON_SECRET not set in $ENV_FILE"
  exit 1
fi

# Try production first, fall back to dev
URL="$PROD_URL"
if ! curl -sf "$PROD_URL/api/health" > /dev/null 2>&1; then
  URL="$DEV_URL"
  if ! curl -sf "$DEV_URL/api/health" > /dev/null 2>&1; then
    echo "$LOG_PREFIX ERROR: Neither production nor dev is responding"
    exit 1
  fi
fi

# A degraded 1Map makes a run outlast its 15-min slot; overlapping runs would
# fight over the same DRs and multiply load on the thing already struggling.
exec 9>/tmp/.backfill-onemap.lock
if ! flock -n 9; then
  echo "$LOG_PREFIX SKIP: previous run still in progress"
  exit 0
fi

RESPONSE=$(curl -sf -X POST "${URL}/api/cron/backfill-onemap-data?mode=unverified&limit=${LIMIT}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 2>&1) || {
  echo "$LOG_PREFIX ERROR: backfill request failed"
  exit 1
}

SUMMARY=$(echo "$RESPONSE" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(f\"processed={d['processed']} succeeded={d['succeeded']} failed={d['failed']} deferred={d.get('deferred',0)}\")" \
  2>/dev/null || echo "parse error")

echo "$LOG_PREFIX OK: ${URL} — ${SUMMARY}"
