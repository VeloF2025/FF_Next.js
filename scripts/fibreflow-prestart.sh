#!/bin/bash
# =============================================================================
# fibreflow-prestart.sh — ExecStartPre guard for fibreflow systemd services
# =============================================================================
# Checks that .next/BUILD_ID exists before starting the service.
# If missing, attempts a rebuild. If rebuild fails, restores from backup.
# This prevents infinite crash-loops when .next is deleted or corrupted.
#
# Usage (in systemd unit):
#   ExecStartPre=/usr/local/bin/fibreflow-prestart /home/velo/fibreflow-dev
# =============================================================================

set -euo pipefail

APP_DIR="${1:?Usage: fibreflow-prestart <app-dir>}"
LOG_FILE="/var/log/fibreflow-prestart.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [prestart] $*" >> "$LOG_FILE"; echo "[prestart] $*"; }

# --- Check if BUILD_ID exists ---
if [ -f "$APP_DIR/.next/BUILD_ID" ]; then
    exit 0  # All good, let the service start
fi

log "WARNING: $APP_DIR/.next/BUILD_ID is missing!"

# --- Try to restore from backup first (fastest recovery) ---
LATEST_BACKUP=$(ls -dt "$APP_DIR"/.next-backup-* "$APP_DIR"/.next-healthcheck-backup 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ] && [ -f "$LATEST_BACKUP/BUILD_ID" ]; then
    log "Restoring from backup: $LATEST_BACKUP"
    mv "$LATEST_BACKUP" "$APP_DIR/.next"
    chown -R velo:velo "$APP_DIR/.next"
    log "Restored .next from backup — service can start"
    exit 0
fi

# --- No valid backup — must rebuild ---
log "No valid backup found. Rebuilding .next..."

# Check deploy lock to avoid racing
for LOCK in /tmp/fibreflow-deploy-*.lock; do
    if [ -f "$LOCK" ]; then
        LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
        if [ "$LOCK_AGE" -lt 600 ]; then
            log "Deploy in progress (lock: $LOCK, age: ${LOCK_AGE}s). Waiting for deploy to finish."
            # Wait up to 5 minutes for the deploy to finish
            for i in $(seq 1 60); do
                sleep 5
                if [ -f "$APP_DIR/.next/BUILD_ID" ]; then
                    log "BUILD_ID appeared (deploy completed). Service can start."
                    exit 0
                fi
                if [ ! -f "$LOCK" ]; then
                    break
                fi
            done
        fi
    fi
done

# Build as velo user
su - velo -c "cd $APP_DIR && NODE_OPTIONS='--max-old-space-size=4096' npm run build" >> "$LOG_FILE" 2>&1
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ] && [ -f "$APP_DIR/.next/BUILD_ID" ]; then
    log "Rebuild successful (BUILD_ID: $(cat "$APP_DIR/.next/BUILD_ID"))"
    exit 0
fi

log "ERROR: Rebuild failed (exit code: $BUILD_EXIT). Service cannot start."
exit 1
