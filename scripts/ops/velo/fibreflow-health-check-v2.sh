#!/bin/bash
# FibreFlow Health Monitor v2.0 - Comprehensive Auto-Recovery
# Checks all FibreFlow services, Docker containers, and logs to database
# Runs every 5 minutes via cron

set -euo pipefail

# ---------------------------------------------------------------------------
# Secrets. Kept OUT of this file so it can live in version control.
# Provision /home/velo/scripts/.fibreflow-health.env (mode 600, owner velo):
#     FIBREFLOW_DB_PASSWORD=...
#     VELO_SUDO_PASSWORD=...
# Missing/unreadable env file is NOT fatal: DB logging and sudo recovery
# degrade to no-ops (logged), rather than taking the monitor down entirely.
# ---------------------------------------------------------------------------
HEALTH_ENV_FILE="${HEALTH_ENV_FILE:-/home/velo/scripts/.fibreflow-health.env}"
if [ -r "$HEALTH_ENV_FILE" ]; then
    # shellcheck disable=SC1090
    . "$HEALTH_ENV_FILE"
fi
FIBREFLOW_DB_PASSWORD="${FIBREFLOW_DB_PASSWORD:-}"
VELO_SUDO_PASSWORD="${VELO_SUDO_PASSWORD:-}"

# Lock file — prevent concurrent runs (build takes 6-8min, cron now runs every 15min)
LOCK_FILE="/tmp/fibreflow-health-check.lock"
LOCK_TIMEOUT=300  # 5 minutes - hard limit to prevent stale locks
if [ -f "$LOCK_FILE" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE") ))
    if [ "$LOCK_AGE" -lt "$LOCK_TIMEOUT" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [SKIP] Previous run still active (lock age: ${LOCK_AGE}s, timeout: ${LOCK_TIMEOUT}s). Exiting." >> /var/log/fibreflow-health.log
        exit 0
    fi
    rm -f "$LOCK_FILE"  # Stale lock (>${LOCK_TIMEOUT}s), remove and proceed
fi
echo $$ > "$LOCK_FILE"

# Reap `next build` jest-worker children rooted in a temp build dir. Defense-in-depth:
# the connection leak itself is fixed in src/lib/db.ts (build-phase min:0 + no warm-up),
# but orphaned workers still waste RAM/CPU if a rebuild is interrupted. Precise — only
# kills workers whose cwd is under the given dir, never a broad `pkill -f node`.
CURRENT_BUILD_DIR=""
reap_build_workers() {
    local dir="$1" pid cwd
    [ -n "$dir" ] || return 0
    for pid in $(pgrep -f 'jest-worker/processChild' 2>/dev/null); do
        cwd=$(sudo -n readlink "/proc/$pid/cwd" 2>/dev/null || readlink "/proc/$pid/cwd" 2>/dev/null || echo "")
        case "$cwd" in
            "$dir"|"$dir"/*) sudo -n kill -9 "$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null ;;
        esac
    done
}

cleanup() {
    reap_build_workers "$CURRENT_BUILD_DIR"
    rm -f "$LOCK_FILE"
    # NB: match the actual mktemp name below (fibreflow-health-rebuild-*), not the
    # old fibreflow-health-check-rebuild-* glob which never matched → /tmp dirs leaked.
    find /tmp -maxdepth 1 -name 'fibreflow-health-rebuild-*' -mmin +60 -exec rm -rf {} + 2>/dev/null
}
trap 'cleanup; exit' INT TERM EXIT

# Configuration
LOG_FILE="/var/log/fibreflow-health.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ISO_TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

# Database connection (Neon Production)
DB_URL="postgresql://fibreflow_user:${FIBREFLOW_DB_PASSWORD}@localhost:5437/fibreflow"

# WhatsApp alerting (via wa-feedback service)
WA_FEEDBACK_URL="http://localhost:8092/send"
ADMIN_GROUP_JID="120363421664266245@g.us"  # Velo Test group

# Logging function
log() {
    echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

# Log recovery action to database
log_recovery_to_db() {
    local SERVICE_NAME="$1"
    local SERVICE_TYPE="$2"
    local ACTION="$3"
    local PREV_STATUS="$4"
    local RESULT="$5"
    local ERROR_MSG="${6:-}"
    local ALERT_SENT="${7:-false}"
    
    # Use psql if available, otherwise skip DB logging
    if command -v psql &> /dev/null; then
        PGPASSWORD="$FIBREFLOW_DB_PASSWORD" psql -h localhost -p 5437 -U fibreflow_user -d fibreflow -c "
            INSERT INTO system_recovery_actions (
                timestamp, service_name, service_type, action_taken, 
                previous_status, result_status, error_message, alert_sent
            ) VALUES (
                '$ISO_TIMESTAMP', '$SERVICE_NAME', '$SERVICE_TYPE', '$ACTION',
                '$PREV_STATUS', '$RESULT', '$ERROR_MSG', $ALERT_SENT
            )
        " 2>/dev/null || log "DB logging failed for $SERVICE_NAME"
    fi
}

# Send WhatsApp alert
send_wa_alert() {
    local MESSAGE="$1"
    curl -s -X POST "$WA_FEEDBACK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"group_jid\": \"$ADMIN_GROUP_JID\", \"message\": \"$MESSAGE\"}" \
        2>/dev/null || log "WA alert failed"
}

# Check HTTP endpoint and restart systemd service if down
check_systemd_service() {
    local SERVICE_NAME="$1"
    local CHECK_URL="$2"
    local SYSTEMD_SERVICE="$3"
    local IS_CRITICAL="${4:-false}"
    
    HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$CHECK_URL" 2>/dev/null) || true
        [ -z "$HTTP_CODE" ] && HTTP_CODE="000"
    
    if [ "$HTTP_CODE" != "200" ]; then
        # Skip restart if a deploy is in progress — avoids racing with npm ci mid-install
        local ENV_SHORT
        ENV_SHORT=$(echo "$SERVICE_NAME" | tr '[:upper:]' '[:lower:]')
        local DEPLOY_LOCK="/tmp/fibreflow-deploy-${ENV_SHORT}.lock"
        if [ -f "$DEPLOY_LOCK" ]; then
            local LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$DEPLOY_LOCK" 2>/dev/null || echo 0) ))
            if [ "$LOCK_AGE" -lt 600 ]; then
                log "SKIP: Deploy in progress for $SERVICE_NAME (lock age: ${LOCK_AGE}s). Not restarting."
                return
            fi
        fi
        log "WARNING: $SERVICE_NAME returned HTTP $HTTP_CODE - Restarting $SYSTEMD_SERVICE"
        echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl restart "$SYSTEMD_SERVICE" 2>/dev/null
        sleep 5
        
        # Verify restart worked
        HTTP_CODE_AFTER=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$CHECK_URL" 2>/dev/null) || true
        [ -z "$HTTP_CODE_AFTER" ] && HTTP_CODE_AFTER="000"
        
        if [ "$HTTP_CODE_AFTER" == "200" ]; then
            log "SUCCESS: $SERVICE_NAME recovered after restart (HTTP $HTTP_CODE_AFTER)"
            log_recovery_to_db "$SERVICE_NAME" "systemd" "restart" "down" "success" "" "false"
        else
            log "ERROR: $SERVICE_NAME still failing after restart (HTTP $HTTP_CODE_AFTER)"
            log_recovery_to_db "$SERVICE_NAME" "systemd" "restart" "down" "failed" "HTTP $HTTP_CODE_AFTER after restart" "false"
            
            # Send alert for critical services
            if [ "$IS_CRITICAL" == "true" ]; then
                send_wa_alert "🚨 CRITICAL: $SERVICE_NAME is DOWN and recovery FAILED! HTTP $HTTP_CODE_AFTER"
                log_recovery_to_db "$SERVICE_NAME" "systemd" "alert_sent" "down" "success" "" "true"
            fi
        fi
    fi
}

# Check Docker container and restart if not running
check_docker_container() {
    local CONTAINER_NAME="$1"
    local DISPLAY_NAME="$2"
    
    CONTAINER_STATUS=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | tr -d '[:space:]') || true
    [ -z "$CONTAINER_STATUS" ] && CONTAINER_STATUS="false"
    
    if [ "$CONTAINER_STATUS" != "true" ]; then
        log "WARNING: Docker container $DISPLAY_NAME is not running - Starting"
        docker start "$CONTAINER_NAME" 2>/dev/null || true
        sleep 5
        
        # Verify restart worked
        CONTAINER_STATUS_AFTER=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | tr -d '[:space:]') || true
    [ -z "$CONTAINER_STATUS_AFTER" ] && CONTAINER_STATUS_AFTER="false"
        
        if [ "$CONTAINER_STATUS_AFTER" == "true" ]; then
            log "SUCCESS: $DISPLAY_NAME container started successfully"
            log_recovery_to_db "$DISPLAY_NAME" "container" "docker_start" "stopped" "success" "" "false"
        else
            log "ERROR: $DISPLAY_NAME container failed to start"
            log_recovery_to_db "$DISPLAY_NAME" "container" "docker_start" "stopped" "failed" "Container did not start" "false"
        fi
    fi
}

# Check a Docker container that also exposes an HTTP endpoint.
#
# check_docker_container() only notices a container that has STOPPED. This one
# also catches the hung-but-running case (process alive, service not answering)
# -- the 2026-07-17 dr-photo-api failure mode, where it silently returned false
# not_found results for hours because nothing ever restarted it.
#
# Fails OPEN: a missing docker CLI or an unknown container name logs and returns
# rather than taking destructive action. Requires 3 consecutive probe failures
# before restarting, so a single slow response (e.g. during the hourly 1Map
# catch-up) cannot trigger a restart.
check_docker_http() {
    local CONTAINER_NAME="$1"
    local DISPLAY_NAME="$2"
    local CHECK_URL="$3"
    local IS_CRITICAL="${4:-false}"

    if ! command -v docker >/dev/null 2>&1; then
        log "SKIP: docker CLI unavailable - cannot check $DISPLAY_NAME"
        return
    fi

    # docker inspect prints an empty line and exits 1 for an unknown container,
    # so test for an EMPTY result -- a literal "missing" sentinel never matches.
    local RUNNING
    RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | tr -d '[:space:]') || true

    if [ -z "$RUNNING" ]; then
        log "SKIP: $DISPLAY_NAME container not found ($CONTAINER_NAME)"
        return
    fi

    local ACTION=""
    if [ "$RUNNING" != "true" ]; then
        log "WARNING: $DISPLAY_NAME container is not running - starting"
        docker start "$CONTAINER_NAME" >/dev/null 2>&1 || true
        ACTION="docker_start"
    else
        # Probe up to 3 times before deciding the service is genuinely wedged.
        local ATTEMPT HTTP_CODE
        HTTP_CODE="000"
        for ATTEMPT in 1 2 3; do
            # curl -w already prints 000 on connection failure; `|| echo 000`
            # would concatenate a second one ("000000").
            HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$CHECK_URL" 2>/dev/null) || true
            [ -z "$HTTP_CODE" ] && HTTP_CODE="000"
            [ "$HTTP_CODE" == "200" ] && return
            [ "$ATTEMPT" -lt 3 ] && sleep 5
        done
        log "WARNING: $DISPLAY_NAME running but HTTP $HTTP_CODE on 3 consecutive probes - restarting container"
        docker restart "$CONTAINER_NAME" >/dev/null 2>&1 || true
        ACTION="docker_restart"
    fi

    # Give the app time to bind and warm up, then verify recovery.
    local HTTP_AFTER="000" WAITED
    for WAITED in 1 2 3 4 5 6; do
        sleep 5
        HTTP_AFTER=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 10 --max-time 30 "$CHECK_URL" 2>/dev/null) || true
        [ -z "$HTTP_AFTER" ] && HTTP_AFTER="000"
        [ "$HTTP_AFTER" == "200" ] && break
    done

    if [ "$HTTP_AFTER" == "200" ]; then
        log "SUCCESS: $DISPLAY_NAME recovered after $ACTION (HTTP $HTTP_AFTER)"
        log_recovery_to_db "$DISPLAY_NAME" "container" "$ACTION" "down" "success" "" "false"
    else
        log "ERROR: $DISPLAY_NAME still failing after $ACTION (HTTP $HTTP_AFTER)"
        log_recovery_to_db "$DISPLAY_NAME" "container" "$ACTION" "down" "failed" "HTTP $HTTP_AFTER after $ACTION" "false"
        if [ "$IS_CRITICAL" == "true" ]; then
            send_wa_alert "🚨 CRITICAL: $DISPLAY_NAME is DOWN and recovery FAILED! HTTP $HTTP_AFTER"
            log_recovery_to_db "$DISPLAY_NAME" "container" "alert_sent" "down" "success" "" "true"
        fi
    fi
}

# Check systemd service status directly (for services without HTTP endpoints)
check_systemd_status() {
    local SERVICE_NAME="$1"
    local SYSTEMD_SERVICE="$2"
    local IS_CRITICAL="${3:-false}"
    
    SERVICE_STATUS=$(echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl is-active "$SYSTEMD_SERVICE" 2>/dev/null) || true
    [ -z "$SERVICE_STATUS" ] && SERVICE_STATUS="unknown"
    
    if [ "$SERVICE_STATUS" != "active" ]; then
        log "WARNING: $SERVICE_NAME is $SERVICE_STATUS - Restarting $SYSTEMD_SERVICE"
        echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl restart "$SYSTEMD_SERVICE" 2>/dev/null
        sleep 5
        
        SERVICE_STATUS_AFTER=$(echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl is-active "$SYSTEMD_SERVICE" 2>/dev/null) || true
    [ -z "$SERVICE_STATUS_AFTER" ] && SERVICE_STATUS_AFTER="unknown"
        
        if [ "$SERVICE_STATUS_AFTER" == "active" ]; then
            log "SUCCESS: $SERVICE_NAME recovered after restart"
            log_recovery_to_db "$SERVICE_NAME" "systemd" "restart" "down" "success" "" "false"
        else
            log "ERROR: $SERVICE_NAME still failing after restart ($SERVICE_STATUS_AFTER)"
            log_recovery_to_db "$SERVICE_NAME" "systemd" "restart" "down" "failed" "Status: $SERVICE_STATUS_AFTER" "false"
            
            if [ "$IS_CRITICAL" == "true" ]; then
                send_wa_alert "🚨 CRITICAL: $SERVICE_NAME is DOWN and recovery FAILED!"
            fi
        fi
    fi
}

# ============================================================================
# FIBREFLOW APP INSTANCES
# ============================================================================

log "Starting health check cycle..."

# Production (app.fibreflow.app - port 3000) - CRITICAL
check_systemd_service "Production" "http://localhost:3000/api/health" "fibreflow-production.service" "true"

# Staging (:3006) removed 2026-07-10 — environment decommissioned, no longer in use.

# Dev (dev.fibreflow.app - port 3005)
check_systemd_service "Dev" "http://localhost:3005/api/health" "fibreflow-dev.service" "false"

# ============================================================================
# NEXT.JS BUILD MANIFEST CHECKS (catches build ID mismatch / stale .next)
# ============================================================================

check_build_manifest() {
    local ENV_NAME="$1"
    local PORT="$2"
    local APP_DIR="$3"
    local SYSTEMD_SERVICE="$4"
    local IS_CRITICAL="${5:-false}"

    BUILD_ID_FILE="$APP_DIR/.next/BUILD_ID"
    if [ ! -f "$BUILD_ID_FILE" ]; then
        log "WARNING: $ENV_NAME has no BUILD_ID file at $BUILD_ID_FILE"
        return
    fi

    BUILD_ID=$(cat "$BUILD_ID_FILE")
    MANIFEST_URL="http://localhost:$PORT/_next/static/$BUILD_ID/_buildManifest.js"

    # Retry before concluding the manifest is broken. A single failure is almost
    # always transient — the service is mid-restart, a deploy just swapped .next, or
    # a network blip — and must NOT trigger the expensive throwaway `next build`.
    # (Needless rebuilds were the recurring trigger of the 2026-07-10 outage.)
    MANIFEST_CODE="000"
    for attempt in 1 2 3; do
        MANIFEST_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$MANIFEST_URL" 2>/dev/null) || true
        [ -z "$MANIFEST_CODE" ] && MANIFEST_CODE="000"
        [ "$MANIFEST_CODE" = "200" ] && break
        [ "$attempt" -lt 3 ] && sleep 10
    done

    if [ "$MANIFEST_CODE" != "200" ]; then
        # If the BUILD_ID file was refreshed very recently, a deploy or a prior rebuild
        # is likely still settling — skip this cycle rather than rebuild on top of it.
        local BUILD_AGE
        BUILD_AGE=$(( $(date +%s) - $(stat -c %Y "$BUILD_ID_FILE" 2>/dev/null || echo 0) ))
        if [ "$BUILD_AGE" -lt 600 ]; then
            log "SKIP: $ENV_NAME manifest HTTP $MANIFEST_CODE but BUILD_ID is only ${BUILD_AGE}s old — likely settling, skipping rebuild"
            return
        fi
        log "WARNING: $ENV_NAME build manifest mismatch! BUILD_ID=$BUILD_ID returned HTTP $MANIFEST_CODE after 3 attempts — rebuilding"

        # --- SAFETY: Check deploy lock to avoid racing with deploy-local.sh ---
        local ENV_SHORT
        ENV_SHORT=$(echo "$ENV_NAME" | tr '[:upper:]' '[:lower:]')
        local DEPLOY_LOCK="/tmp/fibreflow-deploy-${ENV_SHORT}.lock"
        if [ -f "$DEPLOY_LOCK" ]; then
            local LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$DEPLOY_LOCK" 2>/dev/null || echo 0) ))
            if [ "$LOCK_AGE" -lt 600 ]; then
                log "SKIP: Deploy in progress for $ENV_NAME (lock age: ${LOCK_AGE}s). Skipping rebuild."
                return
            fi
        fi

        # --- STEP 1: Stop service BEFORE touching .next (prevents 500s) ---
        log "Stopping $SYSTEMD_SERVICE before rebuild..."
        echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl stop "$SYSTEMD_SERVICE" 2>/dev/null || true

        # --- STEP 2: Backup existing .next ---
        local BACKUP_DIR="$APP_DIR/.next-healthcheck-backup"
        if [ -d "$APP_DIR/.next" ]; then
            rm -rf "$BACKUP_DIR"
            mv "$APP_DIR/.next" "$BACKUP_DIR"
            log "Backed up .next to $BACKUP_DIR"
        fi

        # --- STEP 3: Rebuild in temp directory ---
        TEMP_BUILD_DIR=$(mktemp -d /tmp/fibreflow-health-rebuild-XXXXXX)
        CURRENT_BUILD_DIR="$TEMP_BUILD_DIR"   # register so cleanup() reaps its workers if we exit mid-build
        log "Building in temp: $TEMP_BUILD_DIR"

        # Copy source (exclude .next and .git), symlink node_modules
        rsync -a --exclude='.next' --exclude='.next-*' --exclude='.git' "$APP_DIR/" "$TEMP_BUILD_DIR/" >/dev/null 2>&1
        ln -sf "$APP_DIR/node_modules" "$TEMP_BUILD_DIR/node_modules" 2>/dev/null || true

        # Build
        echo "$VELO_SUDO_PASSWORD" | sudo -S -u velo bash -c "cd $TEMP_BUILD_DIR && NODE_OPTIONS='--max-old-space-size=4096' npm run build" 2>/dev/null
        BUILD_SUCCESS=$?

        # --- STEP 4: Atomic swap or restore backup ---
        if [ $BUILD_SUCCESS -eq 0 ] && [ -f "$TEMP_BUILD_DIR/.next/BUILD_ID" ]; then
            # Atomic move — no window where .next is missing
            mv "$TEMP_BUILD_DIR/.next" "$APP_DIR/.next"
            rm -rf "$BACKUP_DIR"
            log "Atomic swap: new .next installed in $APP_DIR"
        else
            # Build failed — restore backup so service can start on old build
            log "ERROR: Build failed — restoring backup"
            if [ -d "$BACKUP_DIR" ]; then
                mv "$BACKUP_DIR" "$APP_DIR/.next"
                log "Restored .next from backup"
            fi
        fi

        reap_build_workers "$TEMP_BUILD_DIR"   # kill any lingering build workers before removing the dir
        rm -rf "$TEMP_BUILD_DIR"
        CURRENT_BUILD_DIR=""

        # --- STEP 5: Restart service (always — it was stopped) ---
        log "Starting $SYSTEMD_SERVICE..."
        echo "$VELO_SUDO_PASSWORD" | sudo -S systemctl start "$SYSTEMD_SERVICE" 2>/dev/null
        sleep 5

        # --- STEP 6: Verify ---
        NEW_BUILD_ID=$(cat "$BUILD_ID_FILE" 2>/dev/null || echo "unknown")
        NEW_MANIFEST_URL="http://localhost:$PORT/_next/static/$NEW_BUILD_ID/_buildManifest.js"
        NEW_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$NEW_MANIFEST_URL" 2>/dev/null) || true
        [ -z "$NEW_CODE" ] && NEW_CODE="000"

        if [ "$NEW_CODE" == "200" ]; then
            log "SUCCESS: $ENV_NAME build manifest recovered (new BUILD_ID=$NEW_BUILD_ID)"
            log_recovery_to_db "$ENV_NAME" "build_manifest" "rebuild" "mismatch" "success" "" "false"
        else
            log "ERROR: $ENV_NAME build manifest still broken after rebuild (HTTP $NEW_CODE)"
            log_recovery_to_db "$ENV_NAME" "build_manifest" "rebuild" "mismatch" "failed" "HTTP $NEW_CODE" "false"
            if [ "$IS_CRITICAL" == "true" ]; then
                send_wa_alert "🚨 $ENV_NAME build manifest broken! Assets returning 404. Manual intervention needed."
            fi
        fi
    fi
}

check_build_manifest "Production" "3000" "/home/velo/fibreflow-production" "fibreflow-production.service" "true"
# check_build_manifest "Staging" — removed 2026-07-10 (staging decommissioned)
check_build_manifest "Dev" "3005" "/home/velo/fibreflow-dev" "fibreflow-dev.service" "false"

# ============================================================================
# AI/ML SERVICES
# ============================================================================

# VLM (Qwen3) - CRITICAL
check_systemd_service "VLM" "http://localhost:8100/v1/models" "vllm-qwen.service" "true"

# Ollama
check_systemd_service "Ollama" "http://localhost:11434/api/tags" "ollama.service" "false"

# ============================================================================
# MESSAGING SERVICES
# ============================================================================

# WA Feedback Service - CRITICAL
check_systemd_service "WA-Feedback" "http://localhost:8092/health" "wa-feedback.service" "true"

# ============================================================================
# INFRASTRUCTURE
# ============================================================================

# Cloudflared Tunnel - CRITICAL
check_systemd_status "Cloudflared" "cloudflared-tunnel.service" "true"

# PDFCraft
check_systemd_service "PDFCraft" "http://localhost:3007" "pdfcraft.service" "false"

# QField Sync Webhook
check_systemd_service "QField-Sync" "http://localhost:8095/health" "qfield-sync.service" "false"

# ============================================================================
# QFIELDCLOUD DOCKER CONTAINERS
# ============================================================================

# Core containers
check_docker_container "qfieldcloud-nginx-1" "QField-Nginx"
check_docker_container "qfieldcloud-app-1" "QField-App"
check_docker_container "qfieldcloud-db-1" "QField-DB"
check_docker_container "qfieldcloud-minio-1" "QField-MinIO"
check_docker_container "qfieldcloud-memcached-1" "QField-Memcached"

# Worker containers
for i in 1 2 3 4 5 6 7 8; do
    check_docker_container "qfieldcloud-worker_wrapper-$i" "QField-Worker-$i"
done

# ============================================================================
# BOSS DR-PHOTO-API (backs the WA ack "NOT ON 1MAP" lookup) - CRITICAL
# ============================================================================

check_docker_http "dr-photo-api" "DR-Photo-API" "http://localhost:8003/health" "true"

log "Health check cycle complete."
