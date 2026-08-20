#!/usr/bin/env bash
#
# ont-serials-sync-cron.sh — pull new ONT/Gizzu serials from the SharePoint
# master workbook into stock_serials.
#
# Runs every 4 hours from the Velocity crontab. The sync is idempotent
# (ON CONFLICT DO NOTHING on the serial insert), so re-running is free and a
# missed run self-heals on the next one.
#
# Install (production deploy dir, after this ships):
#   0 */4 * * * /home/velo/fibreflow-production/scripts/cron/ont-serials-sync-cron.sh \
#                 >> /tmp/ont-serials-sync-cron.log 2>&1
#
# CRON_SECRET is read from the deploy env file at runtime and never appears in
# the crontab or in this file — the older serial-recheck entry hardcodes its
# bearer token in the crontab, which is exactly what this avoids.
#
# Posts to localhost, not app.fibreflow.app: Cloudflare blocks non-browser
# user agents on the public hostname.

set -euo pipefail

APP_DIR="${APP_DIR:-/home/velo/fibreflow-production}"
PORT="${PORT:-3000}"

log() { echo "[$(TZ=Africa/Johannesburg date '+%Y-%m-%d %H:%M:%S %Z')] $*"; }

secret=""
for env_file in "$APP_DIR/.env.local" "$APP_DIR/.env"; do
  if [[ -f "$env_file" ]]; then
    secret=$(grep -E '^CRON_SECRET=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'" || true)
    [[ -n "$secret" ]] && break
  fi
done

if [[ -z "$secret" ]]; then
  log "ERROR: CRON_SECRET not found in $APP_DIR/.env.local or .env — not running"
  exit 1
fi

log "Starting ONT serial sync..."
response=$(curl -sf --max-time 300 -X POST \
  "http://localhost:${PORT}/api/cron/ont-serials-sync" \
  -H "x-cron-secret: ${secret}") || {
  log "ERROR: sync request failed (curl exit $?)"
  exit 1
}

log "Result: ${response}"

# Surface the two conditions that mean the SOURCE is behind reality, so a stale
# workbook is visible in the log rather than looking like a clean run.
if grep -q '"sourceLikelyStale":true' <<<"$response"; then
  log "WARN: source workbook looks stale — OES-active serials are missing from it"
fi
if grep -qE '"rowsLostToUnresolvedSheets":[1-9]' <<<"$response"; then
  log "WARN: one or more workbook tabs did not resolve to a warehouse — serials skipped"
fi
if grep -qE '"stillInStock":[1-9]' <<<"$response"; then
  log "WARN: OES-active serials are still sitting in_stock after the promotion pass"
fi
if grep -qE '"stillInStock":(2[0-9]{3}|[3-9][0-9]{3})' <<<"$response"; then
  log "ERROR: promotable set exceeded the per-run cap — promotion REFUSED, a human needs to look"
fi
if grep -q '"promotionFailed":true' <<<"$response"; then
  log "WARN: the OES gap promotion did not fully succeed — check the app log for per-serial failures"
fi
