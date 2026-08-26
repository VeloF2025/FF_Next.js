#!/usr/bin/env bash
# Fleet daily stats build.
#
# Calls pages/api/cron/fleet-daily-stats.ts on localhost. The secret is read from the deploy dir's
# env file at run time and passed as an x-cron-secret header (this Fleet module's own convention),
# so it never appears in the crontab, in `ps`, or in this file.
#
# Incremental: each vehicle resumes from its own watermark, so a tick costs roughly what arrived
# since the last one. Safe to run often; safe to miss a run.
#
# A tick that leaves backlog still reports success, so this exits 0 for it. That is deliberate:
# backlog is the normal state of a vehicle catching up and it shrinks by at least one day per
# vehicle per tick, so escalating it would log an ERROR every 15 minutes for hours after a deploy.
# The count is in the echoed body as "vehiclesWithBacklog" -- grep it here if you want to watch a
# catch-up drain.
#
# Install on velo (SAST -- velo cron runs in local time), every 15 minutes:
#   */15 * * * * /home/velo/fibreflow-production/scripts/cron-fleet-daily-stats.sh >> /home/velo/logs/fleet-daily-stats.log 2>&1
#
# Registering that crontab line is a deployment action requiring separate approval; this script
# only exists so that approval has something correct to install.
#
# Exits non-zero on a failed RUN, not merely a failed request.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# shellcheck source=scripts/lib/cron-run-status.sh
. "$SCRIPT_DIR/lib/cron-run-status.sh"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# `|| true` is required: under `set -euo pipefail` a no-match grep exits
# non-zero, which would abort the assignment before the later fallback runs.
env_value() { { [ -f "$1" ] && grep "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2-; } || true; }

# Never hardcode the secret — read it from environment or the deploy env file.
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

URL="http://localhost:${PORT}/api/cron/fleet-daily-stats"

echo "$LOG_PREFIX === Fleet daily stats build start (port ${PORT}) ==="

# -sS keeps it quiet on success but prints the error on failure; -f makes an
# HTTP 4xx/5xx a non-zero exit so a rejected secret is not logged as a success.
# The body is inspected because this endpoint answers 200 even when the RUN
# failed -- see scripts/lib/cron-run-status.sh. `if !` rather than capturing $?:
# under `set -e` an assignment from a failing command substitution aborts before
# $? can be read, which would make the check below dead code.
if ! RESPONSE=$(curl -sS -f -m 300 -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  "$URL"); then
  echo "$LOG_PREFIX ERROR: daily stats build request failed" >&2
  exit 1
fi
echo "$RESPONSE"
report_run_status "daily stats build" "$RESPONSE" "$LOG_PREFIX" || exit 1

echo ""
echo "$LOG_PREFIX === Fleet daily stats build done ==="
