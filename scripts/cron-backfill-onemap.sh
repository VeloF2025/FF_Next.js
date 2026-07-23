#!/usr/bin/env bash
# Backfill OneMap photo/serial data for DRs whose 1Map ingest was incomplete.
#
# Schedule: */15 * * * * /home/velo/fibreflow-production/scripts/cron-backfill-onemap.sh >> /home/velo/logs/backfill-onemap-cron.log 2>&1
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
PROD_ENV="/home/velo/fibreflow-production/.env.local"
DEV_ENV="/home/velo/fibreflow-dev/.env.local"
LIMIT="${LIMIT:-20}"

# Take the lock FIRST. A degraded 1Map is exactly when a run outlasts its
# 15-min slot, and it is also when a health probe against a hung-but-listening
# port can block — so probing before locking would let ticks pile up behind the
# probe, unprotected by the lock that exists to prevent that.
LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/.ff-backfill-onemap.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$LOG_PREFIX SKIP: previous run still in progress"
  exit 0
fi

# Try production first, fall back to dev. Bounded so a hung listener cannot
# stall the run indefinitely.
URL="$PROD_URL"
ENV_FILE="${FF_ENV_FILE:-$PROD_ENV}"
if ! curl -sf --connect-timeout 5 --max-time 10 "$PROD_URL/api/health" > /dev/null 2>&1; then
  if curl -sf --connect-timeout 5 --max-time 10 "$DEV_URL/api/health" > /dev/null 2>&1; then
    URL="$DEV_URL"
    # Read dev's own secret rather than assuming it matches production's.
    ENV_FILE="${FF_ENV_FILE:-$DEV_ENV}"
  else
    echo "$LOG_PREFIX ERROR: Neither production nor dev is responding"
    exit 1
  fi
fi

# Never hardcode the secret — read it from the deploy env (CLAUDE.md rule 11).
if [[ ! -r "$ENV_FILE" ]]; then
  echo "$LOG_PREFIX ERROR: cannot read $ENV_FILE for CRON_SECRET"
  exit 1
fi
# Tolerates `CRON_SECRET=x`, `export CRON_SECRET=x`, quoting, and a trailing
# inline comment; anything else yields empty and is caught below.
CRON_SECRET="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?CRON_SECRET=//p' "$ENV_FILE" \
  | head -1 \
  | sed 's/[[:space:]]*#.*$//' \
  | tr -d '"'"'"' ' \
  )"
if [[ -z "$CRON_SECRET" ]]; then
  echo "$LOG_PREFIX ERROR: CRON_SECRET not set in $ENV_FILE"
  exit 1
fi

RESPONSE=$(curl -sf -X POST "${URL}/api/cron/backfill-onemap-data?mode=unverified&limit=${LIMIT}" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 300 2>&1) || {
  echo "$LOG_PREFIX ERROR: backfill request failed"
  exit 1
}

SUMMARY=$(echo "$RESPONSE" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(f\"processed={d['processed']} succeeded={d['succeeded']} failed={d['failed']} deferred={d.get('deferred',0)} agedOut={d.get('agedOut',0)}\")" \
  2>/dev/null || echo "parse error")

echo "$LOG_PREFIX OK: ${URL} — ${SUMMARY}"
