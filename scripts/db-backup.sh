#!/usr/bin/env bash
# ============================================================
# FibreFlow Neon Database Backup (pg_dump)
# ============================================================
# Cron: 0 2 * * 0  (Sunday 02:00 SAST) on Velocity
# Usage: bash scripts/db-backup.sh
# Installs on Velocity: crontab -e
#   0 2 * * 0 /home/velo/fibreflow-production/scripts/db-backup.sh
# ============================================================

set -euo pipefail

# --- Config ---
BACKUP_DIR="/home/velo/backups/neon"
LOG_FILE="${BACKUP_DIR}/backup.log"
RETENTION_COUNT=4  # Keep 4 weekly backups (rolling 28 days)
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
DUMP_FILE="${BACKUP_DIR}/fibreflow-${DATE}.sql.gz"

# Neon unpooled endpoint (required for pg_dump — pooled PgBouncer doesn't support it)
DB_HOST="ep-dry-night-a9qyh4sj.gwc.azure.neon.tech"
DB_NAME="neondb"
DB_USER="neondb_owner"
DB_PASS="npg_MIUZXrg1tEY0"

# WhatsApp alert config (uses existing bridge pattern)
WA_BRIDGE="http://72.61.197.178:8083/send-message"
WA_GROUP_JID="120363421664266245@g.us"  # Velo Test group

# --- Functions ---
log() {
  echo "[${TIMESTAMP}] $1" | tee -a "$LOG_FILE"
}

send_wa_alert() {
  local message="$1"
  curl -s -X POST "$WA_BRIDGE" \
    -H "Content-Type: application/json" \
    -d "{\"group_jid\":\"${WA_GROUP_JID}\",\"message\":\"${message}\"}" \
    >/dev/null 2>&1 || true
}

# --- Main ---
mkdir -p "$BACKUP_DIR"

log "Starting Neon database backup..."

# Run pg_dump with compression
export PGPASSWORD="$DB_PASS"
if pg_dump \
  -h "$DB_HOST" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --no-owner \
  --no-acl \
  --format=plain \
  --compress=9 \
  2>>"$LOG_FILE" \
  | gzip > "$DUMP_FILE"; then

  DUMP_SIZE=$(du -h "$DUMP_FILE" | cut -f1)
  log "SUCCESS: Backup created: ${DUMP_FILE} (${DUMP_SIZE})"

  # Verify the dump is not empty (minimum 1KB)
  DUMP_BYTES=$(stat -c%s "$DUMP_FILE" 2>/dev/null || stat -f%z "$DUMP_FILE" 2>/dev/null)
  if [ "$DUMP_BYTES" -lt 1024 ]; then
    log "WARNING: Backup file suspiciously small (${DUMP_BYTES} bytes)"
    send_wa_alert "⚠️ DB BACKUP WARNING: Backup created but only ${DUMP_BYTES} bytes — may be corrupt. Check ${LOG_FILE}"
  fi
else
  log "FAILED: pg_dump exited with error"
  send_wa_alert "🔴 DB BACKUP FAILED: pg_dump failed on $(hostname) at ${TIMESTAMP}. Check ${LOG_FILE}"
  exit 1
fi
unset PGPASSWORD

# --- Retention: keep only the last N backups ---
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/fibreflow-*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "$RETENTION_COUNT" ]; then
  DELETE_COUNT=$((BACKUP_COUNT - RETENTION_COUNT))
  log "Cleaning up: removing ${DELETE_COUNT} old backup(s) (keeping ${RETENTION_COUNT})"
  ls -1t "${BACKUP_DIR}"/fibreflow-*.sql.gz | tail -n "$DELETE_COUNT" | while read -r OLD_FILE; do
    log "Deleting old backup: ${OLD_FILE}"
    rm -f "$OLD_FILE"
  done
fi

log "Backup complete. ${BACKUP_COUNT} backups in ${BACKUP_DIR}"
log "---"
