#!/usr/bin/env bash
# ============================================================
# Root Disk Usage Alert
# ============================================================
# Alerts when the Velo root volume crosses a usage threshold.
#
# WHY THIS EXISTS: root (/) is a single 1.9T LVM volume shared by /home and
# /var/lib/docker — QFieldCloud's MinIO volumes alone are ~788G of it. It hit
# 91% in July 2026. The existing disk-growth-predictor.sh only *logs* a
# forecast; nothing actually delivers an alert, so a full root disk is only
# noticed once something breaks.
#
# Cron (SAST): 0 * * * *  /home/velo/fibreflow-production/scripts/check-root-disk.sh
# Usage: bash scripts/check-root-disk.sh [--force]   (--force ignores cooldown)
# ============================================================

set -euo pipefail

THRESHOLD="${ROOT_DISK_THRESHOLD:-80}"
MOUNT="${ROOT_DISK_MOUNT:-/}"
LOG_FILE="${ROOT_DISK_LOG:-/tmp/check-root-disk.log}"
STATE_FILE="${ROOT_DISK_STATE:-/tmp/.check-root-disk.state}"
COOLDOWN_SECONDS="${ROOT_DISK_COOLDOWN:-21600}" # 6h — don't spam an hourly cron

WA_BRIDGE="${WA_BRIDGE_URL:-http://72.61.197.178:8083/send-message}"
WA_GROUP_JID="${WA_ALERT_GROUP_JID:-120363421664266245@g.us}"

FORCE=""
[[ "${1:-}" == "--force" ]] && FORCE=1

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

send_wa_alert() {
  local message="$1"
  curl -s -X POST "$WA_BRIDGE" \
    -H "Content-Type: application/json" \
    -d "{\"group_jid\":\"${WA_GROUP_JID}\",\"message\":\"${message}\"}" \
    >/dev/null 2>&1 || log "WARNING: could not reach WA bridge at ${WA_BRIDGE}"
}

# `df -P` keeps the output on one line even for long device names.
USED_PCT=$(df -P "$MOUNT" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
AVAIL=$(df -Ph "$MOUNT" | awk 'NR==2 {print $4}')

if [[ -z "$USED_PCT" ]]; then
  log "FATAL: could not read usage for $MOUNT"
  exit 1
fi

# Force base-10: df can return zero-padded values ("08") which bash reads as octal.
if (( 10#$USED_PCT < 10#$THRESHOLD )); then
  log "OK: ${MOUNT} at ${USED_PCT}% (threshold ${THRESHOLD}%, ${AVAIL} free)"
  rm -f "$STATE_FILE"
  exit 0
fi

# Over threshold. Respect cooldown unless usage climbed since the last alert.
now=$(date +%s)
if [[ -z "$FORCE" && -f "$STATE_FILE" ]]; then
  last_ts=$(cut -d' ' -f1 "$STATE_FILE" 2>/dev/null || echo 0)
  last_pct=$(cut -d' ' -f2 "$STATE_FILE" 2>/dev/null || echo 0)
  if (( now - last_ts < COOLDOWN_SECONDS )) && (( 10#$USED_PCT <= 10#$last_pct )); then
    log "ALERT suppressed (cooldown): ${MOUNT} at ${USED_PCT}%, last alert $(( (now - last_ts) / 60 ))m ago at ${last_pct}%"
    exit 0
  fi
fi

log "ALERT: ${MOUNT} at ${USED_PCT}% (threshold ${THRESHOLD}%, only ${AVAIL} free)"
send_wa_alert "🔴 DISK ALERT: root ${MOUNT} on $(hostname) is ${USED_PCT}% full (only ${AVAIL} free, threshold ${THRESHOLD}%). Top offender is usually QFieldCloud MinIO under /var/lib/docker."
echo "${now} ${USED_PCT}" > "$STATE_FILE"
