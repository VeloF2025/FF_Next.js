#!/usr/bin/env bash
# Raise an Action Centre item for every H&S audit that has gone overdue.
#
# Schedule: 40 6 * * 1-6 /home/velo/fibreflow-dev/scripts/cron-hs-audit-reminders.sh >> /home/velo/logs/hs-audit-reminders.log 2>&1
#
# The dev deploy dir is only where the file lives (dev deploys are ungated).
# The script itself targets PRODUCTION whenever localhost:3000 answers, and
# falls back to dev only when it does not.
#
# Why this exists: /api/cron/hs-audit-reminders shipped on 2026-07-23 with no
# scheduler at all — the endpoint worked and had never once fired. The same
# omission had already left backfill-onemap-data unscheduled for months while
# its docstring claimed "every 15 minutes". An endpoint without a crontab entry
# is not a scheduled job; it is dead code with a URL.
#
# Modelled on cron-backfill-onemap.sh — same locking, probing and secret rules.

set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
PROD_URL="http://localhost:3000"
DEV_URL="http://localhost:3005"
PROD_ENV="/home/velo/fibreflow-production/.env.local"
DEV_ENV="/home/velo/fibreflow-dev/.env.local"

# Take the lock FIRST, before any probe. A hung-but-listening port is exactly
# when a probe can block, and that is precisely when ticks would otherwise pile
# up behind it, unprotected by the lock that exists to prevent that.
# $HOME, not XDG_RUNTIME_DIR: classic cron sets only HOME/LOGNAME/PATH/LANG/
# SHELL/PWD, so an XDG_RUNTIME_DIR fallback would silently land in
# world-writable /tmp under the scheduler this actually runs under.
LOCK_FILE="${HOME:-/tmp}/.ff-hs-audit-reminders.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$LOG_PREFIX SKIP: previous run still in progress"
  exit 0
fi

# Production first, dev as fallback. Bounded so a hung listener cannot stall
# the run indefinitely.
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
# inline comment. The comment strip requires whitespace before the '#' — a
# secret is not guaranteed to stay plain hex, and `abc#123` must not be
# truncated to `abc`.
CRON_SECRET="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?CRON_SECRET=//p' "$ENV_FILE" \
  | head -1 \
  | sed 's/[[:space:]]\{1,\}#.*$//' \
  | tr -d '"'"'"' ' \
  )"
if [[ -z "$CRON_SECRET" ]]; then
  echo "$LOG_PREFIX ERROR: CRON_SECRET not set in $ENV_FILE"
  exit 1
fi

# This endpoint authenticates on x-cron-secret, not Authorization: Bearer.
RESPONSE=$(curl -sf -X POST "${URL}/api/cron/hs-audit-reminders" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --max-time 120 2>&1) || {
  echo "$LOG_PREFIX ERROR: reminders request failed"
  exit 1
}

# Report the numbers the run actually produced. A bare "OK" would repeat the
# mistake this script exists to correct: a 200 is not evidence of work done.
SUMMARY=$(echo "$RESPONSE" | python3 -c \
  "import sys,json; r=json.load(sys.stdin); d=r.get('data',r); print(f\"overdue={d['overdue']} created={d['created']} refreshed={d['refreshed']} resolved={d['resolved']}\")" \
  2>/dev/null) || SUMMARY="parse error: $(echo "$RESPONSE" | head -c 200)"

echo "$LOG_PREFIX OK: ${URL} — ${SUMMARY}"
