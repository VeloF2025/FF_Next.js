#!/usr/bin/env bash
# Scheduler wrapper only. Install separately after deployment approval:
# 0 9 * * * /home/velo/fibreflow-dev/scripts/cron-velocity-review-export.sh >> /home/velo/logs/velocity-review-export.log 2>&1

set -euo pipefail

LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"
PROD_URL="http://localhost:3000"
DEV_URL="http://localhost:3005"
PROD_ENV="/home/velo/fibreflow-production/.env.local"
DEV_ENV="/home/velo/fibreflow-dev/.env.local"

# Lock before health probing so a hung listener cannot accumulate cron runs.
LOCK_FILE="${HOME:-/tmp}/.ff-velocity-review-export.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$LOG_PREFIX SKIP: previous run still in progress"
  exit 0
fi

URL="$PROD_URL"
ENV_FILE="${FF_ENV_FILE:-$PROD_ENV}"
if ! curl -sf --connect-timeout 5 --max-time 10 "$PROD_URL/api/health" > /dev/null 2>&1; then
  if curl -sf --connect-timeout 5 --max-time 10 "$DEV_URL/api/health" > /dev/null 2>&1; then
    URL="$DEV_URL"
    ENV_FILE="${FF_ENV_FILE:-$DEV_ENV}"
  else
    echo "$LOG_PREFIX ERROR: neither production nor dev is responding"
    exit 1
  fi
fi

if [[ ! -r "$ENV_FILE" ]]; then
  echo "$LOG_PREFIX ERROR: cannot read selected deploy environment"
  exit 1
fi
CRON_SECRET="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\+\)\?CRON_SECRET=//p' "$ENV_FILE" \
  | head -1 \
  | sed 's/[[:space:]]\{1,\}#.*$//' \
  | tr -d '"'"'"' ' \
  )"
if [[ -z "$CRON_SECRET" ]]; then
  echo "$LOG_PREFIX ERROR: CRON_SECRET is not configured in selected deploy environment"
  exit 1
fi

if ! RESPONSE="$(curl -sf -X POST "${URL}/api/cron/velocity-review-export" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  --data '{}' \
  --connect-timeout 5 \
  --max-time 1800 2>/dev/null)"; then
  echo "$LOG_PREFIX ERROR: Velocity review export request failed"
  exit 1
fi

if ! SUMMARY="$(printf '%s' "$RESPONSE" | python3 -c '
import json, sys
root = json.load(sys.stdin)
data = root.get("data", root)
counts = data.get("counts", {})
dates = ",".join(str(item.get("targetDate", "")) for item in data.get("dates", []) if item.get("targetDate")) or "none"
discovered = int(counts.get("candidate_total", 0))
duplicates = int(counts.get("duplicates", 0))
quarantined = int(counts.get("quarantined", 0))
deferred = int(counts.get("pilot_deferred", 0))
contacts_upserted = int(counts.get("contacts_upserted", 0))
acknowledged = int(data.get("workflowAcknowledged", counts.get("completed", 0)))
failures = sum(int(counts.get(key, 0)) for key in ("permanent_failure", "retryable", "ambiguous", "ack_cleanup_pending"))
sources = ",".join(f"{key[7:]}:{int(counts.get(key, 0))}" for key in (
    "source_dr_submitted", "source_drops_installed", "source_stock_installed",
    "source_oes_activated", "source_pp_activated", "source_olt_mismatch_created"))
quarantine_reasons = ",".join(f"{key[11:]}:{int(counts.get(key, 0))}" for key in (
    "quarantine_no_safe_phone", "quarantine_phone_conflict",
    "quarantine_consent_missing", "quarantine_consent_withdrawn"))
print(f"status={data.get('"'"'status'"'"', '"'"'unknown'"'"')} dates={dates} discovered={discovered} contacts_upserted={contacts_upserted} duplicates={duplicates} quarantined={quarantined} pilot_deferred={deferred} sources={sources} quarantine_reasons={quarantine_reasons} acknowledged={acknowledged} failures={failures}")
' 2>/dev/null)"; then
  echo "$LOG_PREFIX ERROR: Velocity review export returned an invalid aggregate response"
  exit 1
fi

echo "$LOG_PREFIX OK: ${URL} ${SUMMARY}"
