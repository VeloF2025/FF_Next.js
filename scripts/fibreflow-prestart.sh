#!/bin/bash
set -euo pipefail
# =============================================================================
# fibreflow-prestart.sh — ExecStartPre guard for fibreflow systemd services
# =============================================================================
# Install at /usr/local/bin/fibreflow-prestart (sudoers entry runs it as root).
#
# Guarantees before fibreflow-{dev,production}.service starts:
#   1. node_modules/.bin/next is executable (atomic-swap recovery on failure).
#   2. All critical .next files exist; otherwise restore from backup or rebuild.
#
# Both recoveries are atomic: if npm ci / rebuild fails, the previous good
# state is restored before the script exits. The service NEVER starts with
# an empty node_modules or a half-written .next.
#
# Usage (in systemd unit):
#   ExecStartPre=+/usr/local/bin/fibreflow-prestart /home/velo/fibreflow-dev
# =============================================================================

APP_DIR="${1:?Usage: fibreflow-prestart <app-dir>}"
LOG_FILE="/var/log/fibreflow-prestart.log"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [prestart] $*" >> "$LOG_FILE"; echo "[prestart] $*"; }

# --- Guard 1: ensure node_modules/.bin/next is usable -------------------------
# Historical context: previous recovery did `rm -rf node_modules && npm ci`,
# but if npm ci failed (OOM, network blip, parallel deploy contention) the dir
# stayed empty and the service started serving 500s on every cookie-touching
# request because next/dist/compiled/cookie was missing. The `|| true` on the
# npm ci call swallowed the failure silently.
#
# Atomic recovery: mv the broken node_modules aside, run npm ci into a fresh
# dir, swap on success. On failure, restore the backup so the service still
# has whatever node_modules it had before — we don't make it worse. If
# nothing works, exit non-zero so systemd doesn't start the service into a
# 500-storm.
if ! su - velo -c "test -x '$APP_DIR/node_modules/.bin/next'" 2>/dev/null; then
    log "WARNING: node_modules/.bin/next not accessible — atomic npm ci recovery..."
    BACKUP_PATH=""
    if su - velo -c "test -e '$APP_DIR/node_modules'" 2>/dev/null; then
        BACKUP_PATH="$APP_DIR/node_modules.prestart-bak.$$"
        su - velo -c "mv '$APP_DIR/node_modules' '$BACKUP_PATH'"
        log "Existing node_modules moved aside to $BACKUP_PATH"
    fi

    NPM_CI_RC=0
    su - velo -c "cd $APP_DIR && npm ci --legacy-peer-deps" >> "$LOG_FILE" 2>&1 || NPM_CI_RC=$?

    if [ "$NPM_CI_RC" -eq 0 ] && su - velo -c "test -x '$APP_DIR/node_modules/.bin/next'" 2>/dev/null; then
        log "node_modules restored OK via npm ci."
        if [ -n "$BACKUP_PATH" ] && [ -d "$BACKUP_PATH" ]; then
            (su - velo -c "rm -rf '$BACKUP_PATH'" &) # async cleanup of old node_modules
        fi
    else
        log "ERROR: npm ci failed (exit $NPM_CI_RC) — restoring previous node_modules"
        su - velo -c "rm -rf '$APP_DIR/node_modules'" 2>/dev/null || true
        if [ -n "$BACKUP_PATH" ] && [ -d "$BACKUP_PATH" ]; then
            su - velo -c "mv '$BACKUP_PATH' '$APP_DIR/node_modules'"
            log "Restored previous node_modules from $BACKUP_PATH"
        fi
        log "ERROR: Recovery failed — service will fail to start. Manual intervention needed."
        exit 1
    fi
fi

# --- Guard 2: ensure .next build is complete ----------------------------------
CRITICAL_FILES=(
    "$APP_DIR/.next/BUILD_ID"
    "$APP_DIR/.next/prerender-manifest.json"
    "$APP_DIR/.next/routes-manifest.json"
    "$APP_DIR/.next/build-manifest.json"
    "$APP_DIR/.next/required-server-files.json"
)

build_complete() {
    for cf in "${CRITICAL_FILES[@]}"; do
        [ -f "$cf" ] || return 1
    done
    [ -d "$APP_DIR/.next/server" ] || return 1
    return 0
}

if build_complete; then
    exit 0
fi

MISSING=""
for cf in "${CRITICAL_FILES[@]}"; do
    [ -f "$cf" ] || MISSING="$MISSING $(basename "$cf")"
done
[ -d "$APP_DIR/.next/server" ] || MISSING="$MISSING server/"
log "WARNING: Incomplete .next build — missing:$MISSING"

# --- Try to restore from backup first (fastest recovery) ---------------------
LATEST_BACKUP=$(ls -dt "$APP_DIR"/.next-backup-* "$APP_DIR"/.next-healthcheck-backup 2>/dev/null | head -1 || true)
if [ -n "$LATEST_BACKUP" ] && [ -f "$LATEST_BACKUP/BUILD_ID" ] && [ -f "$LATEST_BACKUP/prerender-manifest.json" ]; then
    log "Restoring from backup: $LATEST_BACKUP"
    rm -rf "$APP_DIR/.next"
    mv "$LATEST_BACKUP" "$APP_DIR/.next"
    chown -R velo:velo "$APP_DIR/.next"
    log "Restored .next from backup — service can start"
    exit 0
fi

# --- No valid backup — wait for in-flight deploy or rebuild --------------------
log "No valid backup found. Rebuilding .next..."

for LOCK in /tmp/fibreflow-deploy-*.lock; do
    if [ -f "$LOCK" ]; then
        LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || echo 0) ))
        if [ "$LOCK_AGE" -lt 600 ]; then
            log "Deploy in progress (lock: $LOCK, age: ${LOCK_AGE}s). Waiting for deploy to finish."
            for i in $(seq 1 60); do
                sleep 5
                if build_complete; then
                    log "All critical files present (deploy completed). Service can start."
                    exit 0
                fi
                if [ ! -f "$LOCK" ]; then
                    break
                fi
            done
        fi
    fi
done

su - velo -c "cd $APP_DIR && NODE_OPTIONS='--max-old-space-size=4096' npm run build" >> "$LOG_FILE" 2>&1
BUILD_EXIT=$?

if [ $BUILD_EXIT -eq 0 ] && build_complete; then
    log "Rebuild successful (BUILD_ID: $(cat "$APP_DIR/.next/BUILD_ID"))"
    exit 0
fi

log "ERROR: Rebuild failed (exit code: $BUILD_EXIT). Service cannot start."
exit 1
