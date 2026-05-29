#!/usr/bin/env bash
# Sprint E — cron'd serial-register reconcile gate.
#
# Runs the L5 invariant checks (scripts/reconcile-serials.ts, which parses the
# @name/Tolerance blocks in scripts/migrations/sql/reconcile-queries.sql) against
# the live DB. The CLI prints one [OK ]/[FAIL] line per check and exits 0 when all
# pass, 1 when any check exceeds its tolerance — so a non-zero exit here makes cron
# mail / the wrapping log surface the drift.
#
# Checks (name : tolerance):
#   assets_without_serial              : 0
#   issued_without_open_picking        : 100
#   installed_serial_inconsistent_status : 100
#   latest_event_matches_status        : 0
#
# Schedule on velo (times are SAST — velo cron runs in local time, see
# feedback_velo_cron_local_time). Frequency tapers over the cutover window; see
# docs/runbooks/sprint-e-cutover.md:
#   T-0  .. T+48h :  */10 * * * *   (every 10 min)
#   T+48h .. T+1w :  0 * * * *      (hourly)
#   T+1w  onward  :  0 6 * * *      (daily 06:00 SAST)
#
# Crontab line (production deploy dir):
#   */10 * * * * /home/velo/fibreflow-production/scripts/cron-serial-reconcile.sh >> /tmp/serial-reconcile-cron.log 2>&1
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

# Load DATABASE_URL from .env.local (repo cron convention — see scripts/cron-qa-ingest.sh).
if [ -f "$PROJECT_DIR/.env.local" ]; then
  export DATABASE_URL="$(grep '^DATABASE_URL=' "$PROJECT_DIR/.env.local" | head -1 | cut -d= -f2-)"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "$LOG_PREFIX ERROR: DATABASE_URL not set (checked .env.local)" >&2
  exit 1
fi

echo "$LOG_PREFIX === Serial reconcile check start ==="
# exec so the reconcile CLI's exit code becomes this script's exit code.
exec npx tsx scripts/reconcile-serials.ts
