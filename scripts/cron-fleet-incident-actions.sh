#!/usr/bin/env bash
# Fleet incident-actions run: acknowledgement escalation, the 08:15 SAST
# morning summary, and status-monitor health checks.
#
# Calls pages/api/cron/fleet-incident-actions.ts on localhost. The secret is
# read from the deploy dir's env file at run time and passed as an
# x-cron-secret header (this Fleet module's own convention, same as
# fleet-parking-check.ts), so it never appears in the crontab, in `ps`, or in
# this file.
#
# Install on velo (SAST — velo cron runs in local time), at least every five
# minutes so escalation reminders and the 08:15 summary both stay on time:
#   */5 * * * * /home/velo/fibreflow-production/scripts/cron-fleet-incident-actions.sh >> /home/velo/logs/fleet-incident-actions.log 2>&1
#
# Registering this crontab line is a deployment action requiring separate
# approval; this script only exists so that approval has something correct
# to install.
#
# Exits non-zero on a failed run so cron mail and the log both surface it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# shellcheck source=scripts/lib/cron-run-status.sh
. "$SCRIPT_DIR/lib/cron-run-status.sh"
cd "$PROJECT_DIR"

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

URL="http://localhost:${PORT}/api/cron/fleet-incident-actions"

echo "$LOG_PREFIX === Fleet incident-actions start (port ${PORT}) ==="

# This endpoint authenticates on x-cron-secret, not Authorization: Bearer.
# -sS keeps it quiet on success but prints the error on failure; -f makes an
# HTTP 4xx/5xx a non-zero exit so a rejected secret is not logged as a success.
# The body is then inspected because these endpoints answer 200 even when the
# RUN failed -- see scripts/lib/cron-run-status.sh.
# `if !` rather than capturing $? — under `set -e` an assignment from a
# failing command substitution aborts the script before $? can be read,
# which would make the check below dead code.
if ! RESPONSE=$(curl -sS -f -m 120 -X POST -H "x-cron-secret: ${CRON_SECRET}" "$URL"); then
  echo "$LOG_PREFIX ERROR: incident-actions request failed" >&2
  exit 1
fi
echo "$RESPONSE"
report_run_status "incident-actions" "$RESPONSE" "$LOG_PREFIX" || exit 1

echo ""
echo "$LOG_PREFIX === Fleet incident-actions done ==="
