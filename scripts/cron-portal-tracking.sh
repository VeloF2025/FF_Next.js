#!/usr/bin/env bash
# Partner-portal tracking poll (Netstar + Cartrack portal).
# The CRON fires every 10 minutes; the actual per-account cadence lives in
# fleet_tracking_watermarks.poll_interval_minutes and a not-due tick returns
# before any portal call. Do not infer the poll rate from this file.
#
# Calls pages/api/cron/poll-portal-tracking.ts on localhost. The secret is read
# from the deploy dir's env file at run time and passed as a header, so it never
# appears in the crontab, in `ps`, or in this file.
#
# Install on velo (times are SAST — velo cron runs in local time):
#   */10 * * * * /home/velo/fibreflow-production/scripts/cron-portal-tracking.sh >> /home/velo/logs/poll-portal-tracking.log 2>&1
#
# One tick is bounded to ~25 minutes by the client's runtime budget, so a
# degenerate portal cannot run past the next tick and strand the advisory lock.
# Historical recovery is a separate, paced job: scripts/backfill-tracking.ts.
#
# Exits non-zero on a failed run so cron mail and the log both surface it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

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

echo "$LOG_PREFIX === Portal tracking poll start (port ${PORT}) ==="

# -f makes an HTTP 4xx/5xx a non-zero exit, so a rejected secret is not logged
# as a success. The timeout is above the app's own 25-minute tick budget so this
# wrapper never cuts a legitimate run short.
if ! curl -sS -f -m 1800 -H "x-cron-secret: ${CRON_SECRET}" \
     "http://localhost:${PORT}/api/cron/poll-portal-tracking"; then
  echo ""
  echo "$LOG_PREFIX ERROR: portal tracking poll failed" >&2
  exit 1
fi

echo ""
echo "$LOG_PREFIX === Portal tracking poll done ==="
