#!/usr/bin/env bash
# Nightly overnight-parking compliance check (fleet).
#
# Calls pages/api/cron/fleet-parking-check.ts on localhost. The secret is read
# from the deploy dir's env file at run time and passed as a header, so it never
# appears in the crontab, in `ps`, or in this file.
#
# Install on velo (times are SAST — velo cron runs in local time):
#   0 20 * * * /home/velo/fibreflow-production/scripts/cron-fleet-parking-check.sh >> /home/velo/logs/fleet-parking-check.log 2>&1
#
# Backfill a missed night (the endpoint re-runs the check as of 20:00 SAST on
# that date, using the position history already stored):
#   /home/velo/fibreflow-production/scripts/cron-fleet-parking-check.sh 2026-08-04
#
# Exits non-zero on a failed run so cron mail and the log both surface it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

CHECK_DATE="${1:-}"
if [ -n "$CHECK_DATE" ] && ! printf '%s' "$CHECK_DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "$LOG_PREFIX ERROR: date argument must be YYYY-MM-DD, got '$CHECK_DATE'" >&2
  exit 1
fi

# `|| true` is required: under `set -euo pipefail` a no-match grep exits
# non-zero, which would abort the assignment before the later fallback runs.
env_value() { { [ -f "$1" ] && grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; } || true; }

CRON_SECRET="${CRON_SECRET:-$(env_value "$PROJECT_DIR/.env.local" CRON_SECRET)}"
if [ -z "${CRON_SECRET:-}" ]; then
  CRON_SECRET="$(env_value "$PROJECT_DIR/.env" CRON_SECRET)"
fi
if [ -z "${CRON_SECRET:-}" ]; then
  echo "$LOG_PREFIX ERROR: CRON_SECRET not set (checked env, .env.local, .env)" >&2
  exit 1
fi

# Which app this deploy dir is: dev listens on 3005, production on 3000.
PORT="${PORT:-$(env_value "$PROJECT_DIR/.env.local" PORT)}"
if [ -z "${PORT:-}" ]; then
  PORT="$(env_value "$PROJECT_DIR/.env" PORT)"
fi
PORT="${PORT:-3000}"

URL="http://localhost:${PORT}/api/cron/fleet-parking-check"
if [ -n "$CHECK_DATE" ]; then
  URL="${URL}?date=${CHECK_DATE}"
fi

echo "$LOG_PREFIX === Fleet parking check start (port ${PORT}${CHECK_DATE:+, date ${CHECK_DATE}}) ==="

# -sS keeps it quiet on success but prints the error on failure; -f makes an
# HTTP 4xx/5xx a non-zero exit so a rejected secret is not logged as a success.
# The response body is the per-vehicle report and is small enough to keep.
if ! curl -sS -f -m 300 -H "x-cron-secret: ${CRON_SECRET}" "$URL"; then
  echo ""
  echo "$LOG_PREFIX ERROR: parking check request failed" >&2
  exit 1
fi

echo ""
echo "$LOG_PREFIX === Fleet parking check done ==="
