#!/bin/bash
# =============================================================================
# deploy-local.sh — One-Command Local Deploy for FibreFlow
# =============================================================================
# Handles: ownership fix, clean build, retry, service restart, health check.
# Designed to run ON Velocity (no SSH to self).
#
# Usage:
#   bash scripts/deploy-local.sh dev [--branch master]
#   bash scripts/deploy-local.sh production [--force]
#   bash scripts/deploy-local.sh status
# =============================================================================

set -euo pipefail

# --- Configuration ---
TIMEZONE="Africa/Johannesburg"
MAX_RETRIES=3

declare -A ENV_MAP=(
  [dev]="fibreflow-dev.service|3005|/home/velo/fibreflow-dev|https://dev.fibreflow.app"
  [production]="fibreflow-production.service|3000|/home/velo/fibreflow-production|https://app.fibreflow.app"
)

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING:${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $*"; exit 1; }

# --- Parse arguments ---
TARGET="${1:-dev}"
FORCE=false
BRANCH="master"

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f)  FORCE=true; shift ;;
    --branch|-b) BRANCH="$2"; shift 2 ;;
    *)           shift ;;
  esac
done

# GIT_SHA is captured after the pull (Step 2) so it reflects the deployed code.

# --- Time gate ---
is_business_hours() {
  local hour day_of_week
  hour=$(TZ=$TIMEZONE date +%H)
  day_of_week=$(TZ=$TIMEZONE date +%u)
  [[ "$day_of_week" -le 5 && "$hour" -ge 8 && "$hour" -lt 17 ]]
}

if [[ "$TARGET" == "status" ]]; then
  echo -e "\n${BOLD}=== FibreFlow Local Deploy Status ===${NC}"
  echo -e "  Time: $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
  if is_business_hours; then
    echo -e "  Window: ${RED}BUSINESS HOURS${NC} — Dev only"
  else
    echo -e "  Window: ${GREEN}AFTER HOURS${NC} — All envs allowed"
  fi
  echo ""
  for env in dev production; do
    IFS='|' read -r svc port dir url <<< "${ENV_MAP[$env]}"
    commit=$(sudo -u velo bash -c "cd $dir && git rev-parse --short HEAD 2>/dev/null" 2>/dev/null || echo "unknown")
    status=$(systemctl is-active "$svc" 2>/dev/null || echo "unknown")
    printf "  %-12s %-8s  commit: %-10s  %s\n" "$env" "$status" "$commit" "$url"
  done
  echo ""
  exit 0
fi

# --- Validate target ---
if [[ -z "${ENV_MAP[$TARGET]+x}" ]]; then
  error "Unknown environment: $TARGET. Use dev|production|status"
fi

IFS='|' read -r SVC PORT DIR URL <<< "${ENV_MAP[$TARGET]}"

# --- Deploy lock (prevents concurrent deploys to same environment) ---
LOCKFILE="/tmp/fibreflow-deploy-${TARGET}.lock"

acquire_lock() {
  if [[ -f "$LOCKFILE" ]]; then
    local lock_pid lock_age
    lock_pid=$(cat "$LOCKFILE" 2>/dev/null | head -1)
    lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE" 2>/dev/null || echo 0) ))

    # If lock holder is still alive and lock is < 10 minutes old, abort
    if kill -0 "$lock_pid" 2>/dev/null && [[ $lock_age -lt 600 ]]; then
      error "Another deploy to $TARGET is already running (PID $lock_pid, ${lock_age}s ago). Wait for it to finish."
    fi

    # Stale lock — remove it
    warn "Removing stale deploy lock (PID $lock_pid, ${lock_age}s old)"
    rm -f "$LOCKFILE"
  fi
  echo $$ > "$LOCKFILE"
}

release_lock() {
  rm -f "$LOCKFILE"
}

trap release_lock EXIT
acquire_lock

# --- Time gate enforcement ---
if [[ "$TARGET" != "dev" ]] && is_business_hours; then
  if [[ "$FORCE" != true ]]; then
    echo -e "\n${RED}BLOCKED: Cannot deploy to $TARGET during business hours (08:00-17:00 SAST)${NC}"
    echo "  Deploy to dev instead: bash scripts/deploy-local.sh dev"
    echo "  Emergency override:    bash scripts/deploy-local.sh $TARGET --force"
    exit 1
  fi
  warn "EMERGENCY OVERRIDE — Deploying to $TARGET during business hours"
fi

echo -e "\n${BOLD}=== Deploy to $TARGET ===${NC}"
echo -e "  Dir:     $DIR"
echo -e "  Service: $SVC"
echo -e "  URL:     $URL"
echo -e "  Branch:  $BRANCH"
echo -e "  Time:    $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')\n"

DEPLOY_START=$(date +%s)

# --- Step 1: Fix ownership (uses /usr/local/bin/fibreflow-fix-next, NOPASSWD) ---
log "Fixing .next ownership on $DIR..."
if command -v fibreflow-fix-next &>/dev/null; then
  sudo /usr/local/bin/fibreflow-fix-next "$DIR"
else
  # Fallback: try direct chown (may prompt for password)
  warn "fibreflow-fix-next not found. Run: sudo bash scripts/setup-deploy-permissions.sh"
  sudo -u velo bash -c "rm -rf $DIR/.next" 2>/dev/null || true
fi

# --- Step 2: Pull latest code ---
log "Pulling $BRANCH..."
CURRENT_COMMIT=$(sudo -u velo bash -c "cd $DIR && git rev-parse --short HEAD")
sudo -u velo bash -c "cd $DIR && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH"
NEW_COMMIT=$(sudo -u velo bash -c "cd $DIR && git rev-parse --short HEAD")
log "Commit: $CURRENT_COMMIT -> $NEW_COMMIT"

# --- Release tagging for Sentry/Bugsink (BL-54) ---
GIT_SHA="$NEW_COMMIT"
export GIT_SHA
export SENTRY_RELEASE="$GIT_SHA"
export NEXT_PUBLIC_GIT_SHA="$GIT_SHA"
log "Release SHA: $GIT_SHA"

# --- Step 3: Install deps if needed ---
if sudo -u velo bash -c "cd $DIR && git diff --name-only $CURRENT_COMMIT HEAD 2>/dev/null" | grep -q 'package.json'; then
  log "package.json changed, running npm install..."
  sudo -u velo bash -c "cd $DIR && npm install --legacy-peer-deps"
fi

# --- Step 3b: Run lint gates (Zero Tolerance) ---
if [[ "$FORCE" != true ]]; then
  log "Running lint gates..."
  LINT_FAILED=false
  MAX_LINT_WARNINGS=3825
  MAX_LINT_ERRORS=77

  LINT_OUTPUT=$(sudo -u velo bash -c "cd $DIR && npm run lint" 2>&1 || true)
  LINT_SUMMARY=$(echo "$LINT_OUTPUT" | grep -P '\d+ problems? \(' || echo "0 problems (0 errors, 0 warnings)")
  LINT_ERRORS=$(echo "$LINT_SUMMARY" | grep -oP '\d+ error' | grep -oP '\d+' || echo "0")
  LINT_WARNINGS=$(echo "$LINT_SUMMARY" | grep -oP '\d+ warning' | grep -oP '\d+' || echo "0")

  if [[ "$LINT_WARNINGS" -gt "$MAX_LINT_WARNINGS" ]]; then
    warn "New lint warnings: ${LINT_WARNINGS} (max ${MAX_LINT_WARNINGS})"
    LINT_FAILED=true
  fi
  if [[ "$LINT_ERRORS" -gt "$MAX_LINT_ERRORS" ]]; then
    warn "New lint errors: ${LINT_ERRORS} (max ${MAX_LINT_ERRORS})"
    echo "$LINT_OUTPUT" | grep "  error  " | tail -5 | sed 's/^/    /'
    LINT_FAILED=true
  fi

  if [[ "$LINT_FAILED" == true ]]; then
    error "Lint gates failed. Fix issues or use --force to bypass."
  fi
  log "Lint gates passed: ${LINT_ERRORS} errors (≤${MAX_LINT_ERRORS}), ${LINT_WARNINGS} warnings (≤${MAX_LINT_WARNINGS}) ✓"
else
  warn "Skipping lint gates (--force)"
fi

# --- Step 4: Stop service to free resources ---
log "Stopping $SVC..."
sudo /usr/bin/systemctl stop "$SVC" 2>/dev/null || true

# --- Step 5: Clean .next to prevent stale artifacts ---
log "Cleaning .next directory..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if sudo -u velo test -d "$DIR/.next"; then
  sudo -u velo bash -c "cd $DIR && mv .next .next-backup-$TIMESTAMP"
  log "Backed up existing build to .next-backup-$TIMESTAMP"
fi

# --- Step 6: Build with retry ---
BUILD_SUCCESS=false
for attempt in $(seq 1 $MAX_RETRIES); do
  log "Build attempt $attempt/$MAX_RETRIES..."
  if sudo -u velo GIT_SHA="$GIT_SHA" SENTRY_RELEASE="$SENTRY_RELEASE" NEXT_PUBLIC_GIT_SHA="$NEXT_PUBLIC_GIT_SHA" bash -c "cd $DIR && npm run build" 2>&1; then
    BUILD_SUCCESS=true
    break
  fi
  if [[ $attempt -lt $MAX_RETRIES ]]; then
    warn "Build failed (attempt $attempt) — retrying in 5s (Next.js race condition)..."
    sleep 5
    # Clean partial build artifacts before retry
    sudo -u velo bash -c "cd $DIR && rm -rf .next" 2>/dev/null || true
  fi
done

if [[ "$BUILD_SUCCESS" != true ]]; then
  echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} Build failed after $MAX_RETRIES attempts."
  # Restore backup BEFORE exiting — never leave the environment without a .next
  if sudo -u velo test -d "$DIR/.next-backup-$TIMESTAMP"; then
    log "Restoring .next from backup..."
    sudo -u velo bash -c "cd $DIR && mv .next-backup-$TIMESTAMP .next"
  fi
  log "Starting $SVC on previous build..."
  sudo /usr/bin/systemctl start "$SVC" 2>/dev/null || true
  exit 1
fi

# --- Step 7: Validate build (all critical Next.js files, not just BUILD_ID) ---
CRITICAL_FILES=(
  ".next/BUILD_ID"
  ".next/prerender-manifest.json"
  ".next/routes-manifest.json"
  ".next/build-manifest.json"
  ".next/required-server-files.json"
)
BUILD_VALID=true
for cf in "${CRITICAL_FILES[@]}"; do
  if ! sudo -u velo test -f "$DIR/$cf"; then
    echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} Missing: $cf — build is incomplete"
    BUILD_VALID=false
  fi
done
if ! sudo -u velo test -d "$DIR/.next/server"; then
  echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} Missing: .next/server/ — build is incomplete"
  BUILD_VALID=false
fi

if [[ "$BUILD_VALID" != true ]]; then
  if sudo -u velo test -d "$DIR/.next-backup-$TIMESTAMP"; then
    log "Restoring .next from backup..."
    sudo -u velo bash -c "cd $DIR && rm -rf .next && mv .next-backup-$TIMESTAMP .next"
  fi
  log "Starting $SVC on previous build..."
  sudo /usr/bin/systemctl start "$SVC" 2>/dev/null || true
  exit 1
fi
BUILD_ID=$(sudo -u velo cat "$DIR/.next/BUILD_ID")
log "Build validated (BUILD_ID: $BUILD_ID, all ${#CRITICAL_FILES[@]} critical files present)"

# --- Step 8: Start service ---
log "Starting $SVC..."
sudo /usr/bin/systemctl start "$SVC"
sleep 5

if ! systemctl is-active --quiet "$SVC"; then
  echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} Service $SVC failed to start. Check: journalctl -u $SVC -n 50"
  # Try once more after a brief pause
  sleep 3
  sudo /usr/bin/systemctl start "$SVC" 2>/dev/null || true
  sleep 5
  if ! systemctl is-active --quiet "$SVC"; then
    warn "Service still not running — manual intervention may be needed"
    exit 1
  fi
  log "Service started on retry"
fi
log "Service $SVC is active"

# --- Step 9: Health check ---
log "Running health check on $URL..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$URL/sign-in" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
  log "Health check passed (HTTP $HTTP_CODE)"
else
  warn "Health check returned HTTP $HTTP_CODE — may still be starting up"
fi

# --- Step 10: Clean old backups (keep last 3) ---
sudo -u velo bash -c "cd $DIR && ls -dt .next-backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf"

# --- Summary ---
DEPLOY_END=$(date +%s)
DURATION=$((DEPLOY_END - DEPLOY_START))

echo ""
echo -e "${BOLD}===== DEPLOYMENT COMPLETE =====${NC}"
echo -e "  Environment: ${GREEN}$TARGET${NC}"
echo -e "  Commit:      $CURRENT_COMMIT -> $NEW_COMMIT"
echo -e "  Build ID:    $BUILD_ID"
echo -e "  Duration:    ${DURATION}s"
echo -e "  URL:         $URL"
echo -e "  Health:      HTTP $HTTP_CODE"
echo -e "  Time:        $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
echo "==============================="

# --- Step 11: Finalize Sentry release (BL-54, fail-open) ---
if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && command -v sentry-cli >/dev/null 2>&1; then
  log "Finalizing Sentry release $GIT_SHA..."
  sentry-cli releases finalize "$GIT_SHA" || warn "sentry-cli finalize failed (non-fatal)"
  sentry-cli releases deploys "$GIT_SHA" new -e "$TARGET" \
    || warn "sentry-cli deploys failed (non-fatal)"
else
  log "Skipping Sentry release finalize (no SENTRY_AUTH_TOKEN or sentry-cli)"
fi
