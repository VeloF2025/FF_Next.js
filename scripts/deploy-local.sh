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
  # Force base-10: date +%H yields zero-padded "08"/"09", which arithmetic
  # contexts parse as invalid octal ("[[: 08: value too great for base").
  hour=$((10#$(TZ=$TIMEZONE date +%H)))
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
# Reset files a prior local `npm ci`/build regenerates that would otherwise block
# the pull with a dirty working tree:
#   - package-lock.json (npm install rewrites it)
#   - node_modules — committed as a symlink to the workspace; a real dir left by a
#     previous npm ci shows as a deletion and blocks `git pull` (observed on prod
#     2026-05-26). `git checkout --` cleanly restores the symlink; npm ci rebuilds
#     node_modules after the pull.
sudo -u velo bash -c "cd $DIR && git checkout -- package-lock.json 2>/dev/null || true"
sudo -u velo bash -c "cd $DIR && git checkout -- node_modules 2>/dev/null || true"
sudo -u velo bash -c "cd $DIR && git fetch origin && git checkout $BRANCH && git pull origin $BRANCH" \
  || error "git pull failed for $DIR (dirty tree or network) — aborting before any build/restart"
NEW_COMMIT=$(sudo -u velo bash -c "cd $DIR && git rev-parse --short HEAD")
# Compare FULL SHAs (two independent --short calls can pick different prefix lengths).
NEW_SHA=$(sudo -u velo bash -c "cd $DIR && git rev-parse HEAD")
EXPECTED_SHA=$(sudo -u velo bash -c "cd $DIR && git rev-parse origin/$BRANCH")
if [[ "$NEW_SHA" != "$EXPECTED_SHA" ]]; then
  error "Post-pull HEAD ($NEW_COMMIT) != origin/$BRANCH — pull did not land, aborting"
fi
log "Commit: $CURRENT_COMMIT -> $NEW_COMMIT"

# --- Release tagging for Sentry/Bugsink (BL-54) ---
GIT_SHA="$NEW_COMMIT"
export GIT_SHA
export SENTRY_RELEASE="$GIT_SHA"
export NEXT_PUBLIC_GIT_SHA="$GIT_SHA"
log "Release SHA: $GIT_SHA"

# --- Step 3 helper: atomic npm ci with rollback on failure ---
# `npm ci` deletes node_modules before installing. If the install fails (OOM,
# network blip, parallel-deploy contention) the dir is left empty, breaking
# the service at runtime because next/dist/compiled/cookie and friends are
# missing — every cookie-touching request 500s.
#
# Strategy: move the current node_modules aside, run npm ci, swap on success.
# On failure, restore the backup so node_modules is at least no WORSE than
# before. The build step that follows will fail loudly if recovery doesn't
# produce a usable .bin/next.
atomic_npm_ci() {
  local reason="$1"
  local backup=""
  if sudo -u velo bash -c "test -e '$DIR/node_modules'"; then
    backup="$DIR/node_modules.deploy-bak.$$"
    sudo -u velo bash -c "mv '$DIR/node_modules' '$backup'"
    log "node_modules moved aside to $(basename "$backup") (reason: $reason)"
  fi

  local rc=0
  sudo -u velo bash -c "cd $DIR && npm ci --legacy-peer-deps" || rc=$?

  if [[ "$rc" -eq 0 ]] && sudo -u velo bash -c "test -x '$DIR/node_modules/.bin/next'"; then
    log "npm ci succeeded ($reason) — node_modules ready."
    if [[ -n "$backup" ]] && sudo -u velo bash -c "test -d '$backup'"; then
      (sudo -u velo bash -c "rm -rf '$backup'" &) # async cleanup
    fi
    return 0
  fi

  warn "npm ci failed (exit $rc) — attempting rollback"
  sudo -u velo bash -c "rm -rf '$DIR/node_modules'" 2>/dev/null || true
  local restored=false
  if [[ -n "$backup" ]] && sudo -u velo bash -c "test -d '$backup'"; then
    if sudo -u velo bash -c "mv '$backup' '$DIR/node_modules'"; then
      restored=true
      log "Restored previous node_modules from $(basename "$backup")"
    else
      warn "Failed to restore backup from $(basename "$backup") — node_modules now MISSING"
    fi
  fi
  if [[ "$restored" == true ]]; then
    error "npm ci failed ($reason). Previous node_modules restored (may also be broken). Investigate and redeploy."
  else
    error "npm ci failed ($reason). No backup to restore — node_modules is MISSING. Run npm ci manually before next deploy."
  fi
}

# --- Sweep stale npm-ci backups (>24h old) from prior failed deploys ---
# atomic_npm_ci async-cleans backups on success but a SIGKILL or sudo
# permission failure can leave .deploy-bak.<PID> dirs around. Clean them
# up at the start of every deploy so they don't accumulate on disk.
sudo -u velo bash -c "find '$DIR' -maxdepth 1 -name 'node_modules.deploy-bak.*' -mtime +0 -exec rm -rf {} + 2>/dev/null || true"

# --- Step 3: Install deps if package.json changed in the pull ---
if sudo -u velo bash -c "cd $DIR && git diff --name-only $CURRENT_COMMIT HEAD 2>/dev/null" | grep -q 'package.json'; then
  log "package.json changed, running atomic npm ci..."
  atomic_npm_ci "package.json changed"
fi

# --- Step 3 (guard): Validate node_modules is usable (catches dangling symlink) ---
# node_modules may be a symlink to the workspace; if that target was wiped the build silently
# fails with "next: not found" (exit 127). Detect this before touching .next.
if ! sudo -u velo bash -c "test -x '$DIR/node_modules/.bin/next'"; then
  log "WARNING: node_modules/.bin/next not accessible — atomic npm ci recovery..."
  atomic_npm_ci "node_modules/.bin/next missing"
  log "node_modules restored OK."
fi

# --- Step 3a: Apply pending DB migrations (fail fast before build) ---
log "Checking DB migrations..."
MIGRATION_EXIT=0
sudo -u velo bash -c "cd $DIR && bash scripts/run-pending-migrations.sh 2>&1 | sed 's/^/  /'" || MIGRATION_EXIT=$?
if [[ "$MIGRATION_EXIT" -ne 0 ]]; then
  error "DB migration failed (exit $MIGRATION_EXIT). Fix the SQL and redeploy."
fi

# --- Step 3a': Sync nginx config from repo (idempotent) ---
# The tracked snapshot at docs/VPS/vf-fibreflow.nginx.conf is the source of
# truth for the public-facing nginx config (proxy rules + the
# /storage/staff/payslips/ deny rule that protects payroll PDFs). If the
# checked-in version differs from /etc/nginx/sites-enabled/vf-fibreflow we
# stage it, run `nginx -t` as a syntax gate, and reload nginx. A failed
# config test aborts the deploy before service restart so we never trip the
# next step with broken nginx.
NGINX_SOURCE="$DIR/docs/VPS/vf-fibreflow.nginx.conf"
NGINX_TARGET="/etc/nginx/sites-enabled/vf-fibreflow"
# Backups MUST live OUTSIDE sites-enabled/, otherwise nginx's `*` glob
# pulls them in as additional server blocks (each with a duplicate
# `default_server`), failing `nginx -t` with "duplicate default server".
NGINX_BAK_DIR="/etc/nginx/backups"
NGINX_BAK_TS=$(date +%Y%m%d_%H%M%S)
# Clean up any stray backups left in the broken location by older versions
# of this script — they break nginx -t.
sudo rm -f /etc/nginx/sites-enabled/vf-fibreflow.bak.* 2>/dev/null || true
if [[ -f "$NGINX_SOURCE" ]]; then
  if ! cmp -s "$NGINX_SOURCE" "$NGINX_TARGET" 2>/dev/null; then
    log "Nginx config changed — staging + testing..."
    sudo mkdir -p "$NGINX_BAK_DIR"
    HAD_PRIOR_TARGET=false
    NGINX_BAK_PATH="$NGINX_BAK_DIR/vf-fibreflow.bak.$NGINX_BAK_TS"
    if [[ -f "$NGINX_TARGET" ]]; then
      sudo cp "$NGINX_TARGET" "$NGINX_BAK_PATH"
      HAD_PRIOR_TARGET=true
    fi
    sudo cp "$NGINX_SOURCE" "$NGINX_TARGET"
    # Capture nginx -t exit code separately — `cmd | sed` would surface
    # sed's exit code (almost always 0) and silently pass a broken config.
    NGINX_TEST_OUT=$(sudo /usr/sbin/nginx -t 2>&1) && NGINX_TEST_RC=$? || NGINX_TEST_RC=$?
    echo "$NGINX_TEST_OUT" | sed 's/^/  /'
    if [[ "$NGINX_TEST_RC" -eq 0 ]]; then
      sudo /usr/bin/systemctl reload nginx
      log "Nginx config synced + reloaded."
      # Prune backups older than 7 days so they don't accumulate forever.
      sudo find "$NGINX_BAK_DIR" -name 'vf-fibreflow.bak.*' -mtime +7 -delete 2>/dev/null || true
    else
      warn "nginx -t failed (rc=$NGINX_TEST_RC) — restoring previous config and aborting deploy"
      if [[ "$HAD_PRIOR_TARGET" == "true" ]]; then
        sudo cp "$NGINX_BAK_PATH" "$NGINX_TARGET"
      else
        sudo rm -f "$NGINX_TARGET"
      fi
      error "Nginx config invalid. See output above and fix docs/VPS/vf-fibreflow.nginx.conf."
    fi
  fi
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

# --- Step 10b: Resolve deployed tickets ---
# Scan commit messages in the window just deployed for VF-YYYYMMDD-NNN refs.
# Any ticket still in assigned/in_progress is marked resolved. Fail-open: a
# DB error never blocks the summary or Sentry step.
#
# Security note: TICKET_UID values are validated by grep to match
# VF-[0-9]{8}-[0-9]+ (digits and hyphens only). psql -v is used for
# defence-in-depth parameterization regardless.
RESOLVED_TICKETS=""
if [[ "$CURRENT_COMMIT" != "$NEW_COMMIT" ]]; then
  mapfile -t TICKET_REFS < <(
    sudo -u velo bash -c "cd '$DIR' && git log '$CURRENT_COMMIT'..'$NEW_COMMIT' --format='%B' 2>/dev/null" \
      | grep -oE '\bVF-[0-9]{8}-[0-9]+\b' | sort -u 2>/dev/null
  ) || true

  if [[ ${#TICKET_REFS[@]} -gt 0 ]]; then
    PGURL=$(sudo -u velo bash -c "grep '^DATABASE_URL=' '$DIR/.env.local' 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\"'" 2>/dev/null || true)
    if [[ -n "$PGURL" ]]; then
      for TICKET_UID in "${TICKET_REFS[@]}"; do
        UPDATED=$(sudo -u velo bash -c \
          "psql \"$PGURL\" -t -q -v \"uid=$TICKET_UID\" -c \"UPDATE maintenance_tickets SET status='resolved', updated_at=NOW() WHERE ticket_uid=:'uid' AND status IN ('assigned','in_progress') RETURNING ticket_uid\" 2>/dev/null" \
          | tr -d ' \n' || true)
        if [[ -n "$UPDATED" ]]; then
          log "Ticket $TICKET_UID → resolved"
          RESOLVED_TICKETS="${RESOLVED_TICKETS} $TICKET_UID"
        fi
      done
    else
      warn "Ticket resolution skipped — DATABASE_URL not found in $DIR/.env.local"
    fi
  fi
fi

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
if [[ -n "$RESOLVED_TICKETS" ]]; then
  echo -e "  Resolved:   ${GREEN}${RESOLVED_TICKETS}${NC}"
fi
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
