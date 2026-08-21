#!/usr/bin/env bash
# Fleet operational retention pass.
#
# Calls pages/api/cron/fleet-operational-retention.ts on localhost. The secret
# is read from the deploy dir's env file at run time and passed as an
# x-cron-secret header (this Fleet module's own convention), so it never
# appears in the crontab, in `ps`, or in this file.
#
# DRY RUN ONLY. This wrapper sends {"dryRun": true} and has no switch to send
# anything else: a scheduled job that can delete evidence about named people
# should not be one edit away from doing so. Enabling live retention is a
# deliberate, separately approved act — flip live_retention_enabled in the
# effective Fleet analytics settings and invoke the endpoint with an explicit
# {"dryRun": false}, with someone watching.
#
# Install on velo (SAST — velo cron runs in local time), 03:30 daily, after the
# 01:00 aggregation run, because retention cannot purge a month the aggregate
# pipeline has not covered:
#   30 3 * * * /home/velo/fibreflow-production/scripts/cron-fleet-operational-retention.sh >> /home/velo/logs/fleet-operational-retention.log 2>&1
#
# Registering this crontab line is a deployment action requiring separate
# approval; this script only exists so that approval has something correct
# to install.
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

URL="http://localhost:${PORT}/api/cron/fleet-operational-retention"

echo "$LOG_PREFIX === Fleet operational retention dry run start (port ${PORT}) ==="

# -sS keeps it quiet on success but prints the error on failure; -f makes an
# HTTP 4xx/5xx a non-zero exit so a rejected secret is not logged as a success.
if ! curl -sS -f -m 300 -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}' \
  "$URL"; then
  echo ""
  echo "$LOG_PREFIX ERROR: retention request failed" >&2
  exit 1
fi

echo ""
echo "$LOG_PREFIX === Fleet operational retention dry run done ==="
