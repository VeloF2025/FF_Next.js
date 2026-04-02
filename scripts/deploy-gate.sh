#!/bin/bash
# =============================================================================
# deploy-gate.sh — Time-Gated Deployment Wrapper for FibreFlow
# =============================================================================
# Enforces deployment rules:
#   - DEV:        Always allowed (any time)
#   - PRODUCTION: Blocked during business hours (08:00-17:00 SAST Mon-Fri)
#
# Usage:
#   bash scripts/deploy-gate.sh dev                    # Deploy to dev (always OK)
#   bash scripts/deploy-gate.sh production             # Blocked during business hours
#   bash scripts/deploy-gate.sh production --force     # Emergency override
#   bash scripts/deploy-gate.sh status                 # Show all environments
#
# Exit code: 0 = success, 1 = blocked or failed
# =============================================================================

set -e

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VELOCITY_HOST="100.96.203.105"
VELOCITY_USER="velo"
SUDO_PASS="velo2026"
TIMEZONE="Africa/Johannesburg"

# --- Local detection ---
# If running on Velocity, use deploy-local.sh directly (no SSH overhead)
HOSTNAME_SHORT=$(hostname -s 2>/dev/null || hostname)
if [[ "$HOSTNAME_SHORT" == "velo-server" || "$HOSTNAME_SHORT" == "velocity" ]]; then
  exec bash "$SCRIPT_DIR/deploy-local.sh" "$@"
fi

declare -A ENV_MAP=(
  [dev]="fibreflow-dev|3005|/home/velo/fibreflow-dev|https://dev.fibreflow.app"
  [production]="fibreflow-production|3000|/home/velo/fibreflow-production|https://app.fibreflow.app"
)

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARNING:${NC} $*"; }
error() { echo -e "${RED}[$(date +%H:%M:%S)] ERROR:${NC} $*"; exit 1; }
info()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $*"; }

# --- Parse arguments ---
TARGET="${1:-}"
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

# --- Helper: Check if business hours ---
is_business_hours() {
  local hour day_of_week
  hour=$(TZ=$TIMEZONE date +%H)
  day_of_week=$(TZ=$TIMEZONE date +%u)  # 1=Mon, 7=Sun

  # Weekday (Mon-Fri) between 08:00-16:59
  if [ "$day_of_week" -le 5 ] && [ "$hour" -ge 8 ] && [ "$hour" -lt 17 ]; then
    return 0  # true = business hours
  fi
  return 1  # false = after hours
}

# --- Helper: Get env config ---
get_env_config() {
  local env="$1"
  local config="${ENV_MAP[$env]}"
  if [ -z "$config" ]; then
    error "Unknown environment: $env. Use dev|production"
  fi
  echo "$config"
}

# --- Helper: Get commit on server ---
get_server_commit() {
  local dir="$1"
  ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
    "cd $dir && git rev-parse --short HEAD 2>/dev/null" 2>/dev/null || echo "unknown"
}

# --- Status command ---
show_status() {
  echo ""
  echo -e "${BOLD}=== FibreFlow Deployment Status ===${NC}"
  echo -e "  Time: $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"

  if is_business_hours; then
    echo -e "  Window: ${RED}BUSINESS HOURS${NC} — Only dev deploys allowed"
  else
    echo -e "  Window: ${GREEN}AFTER HOURS${NC} — All deploys allowed"
  fi
  echo ""

  for env in dev production; do
    IFS='|' read -r svc port dir url <<< "${ENV_MAP[$env]}"
    local commit
    commit=$(get_server_commit "$dir")
    local status
    status=$(ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
      "systemctl is-active $svc 2>/dev/null" 2>/dev/null || echo "unknown")

    local status_color="$RED"
    [ "$status" = "active" ] && status_color="$GREEN"

    local gate_color="$GREEN"
    local gate_label="OPEN"
    if [ "$env" != "dev" ] && is_business_hours; then
      gate_color="$RED"
      gate_label="LOCKED"
    fi

    printf "  %-12s ${status_color}%-8s${NC}  commit: %-10s  gate: ${gate_color}%s${NC}  %s\n" \
      "$env" "$status" "$commit" "$gate_label" "$url"
  done

  echo ""
  return 0
}

# --- Main: Handle status command ---
if [ "$TARGET" = "status" ]; then
  show_status
  exit 0
fi

# --- Validate target ---
if [ -z "$TARGET" ]; then
  echo "Usage: deploy-gate.sh <dev|production|status> [--force] [--branch <branch>]"
  echo ""
  echo "Rules:"
  echo "  dev         Always allowed"
  echo "  production  Blocked 08:00-17:00 SAST Mon-Fri (use --force for emergencies)"
  echo "  status      Show all environments"
  exit 1
fi

IFS='|' read -r SVC PORT DIR URL <<< "$(get_env_config "$TARGET")"

# --- Time gate enforcement ---
echo ""
echo -e "${BOLD}=== FibreFlow Deploy Gate ===${NC}"
echo -e "  Target:  ${BOLD}$TARGET${NC} ($URL)"
echo -e "  Branch:  $BRANCH"
echo -e "  Time:    $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
echo ""

if [ "$TARGET" != "dev" ] && is_business_hours; then
  if [ "$FORCE" = true ]; then
    warn "EMERGENCY OVERRIDE — Deploying to $TARGET during business hours"
    warn "People are actively using $URL right now"
    echo ""
    read -p "Type 'EMERGENCY' to confirm: " -r
    if [ "$REPLY" != "EMERGENCY" ]; then
      error "Deploy cancelled — override not confirmed"
    fi
    log "Emergency override confirmed"
  else
    echo -e "${RED}  BLOCKED: Cannot deploy to $TARGET during business hours (08:00-17:00 SAST)${NC}"
    echo ""
    echo "  People are actively using $URL."
    echo "  Deploy to dev instead and promote after hours."
    echo ""
    echo "  Options:"
    echo "    bash scripts/deploy-gate.sh dev              # Deploy to dev now"
    echo "    bash scripts/deploy-gate.sh $TARGET --force  # Emergency override"
    echo ""
    exit 1
  fi
fi

# --- Pre-deploy checks ---
log "Running pre-deploy checks for $TARGET..."
if [ -f "$SCRIPT_DIR/pre-deploy-check.sh" ]; then
  ssh ${VELOCITY_USER}@${VELOCITY_HOST} "bash -s" < "$SCRIPT_DIR/pre-deploy-check.sh" "$TARGET" || {
    error "Pre-deploy checks failed — resolve issues before deploying"
  }
else
  warn "pre-deploy-check.sh not found, skipping safety checks"
fi

# --- Deploy ---
log "Deploying to $TARGET..."
DEPLOY_START=$(date +%s)

ssh ${VELOCITY_USER}@${VELOCITY_HOST} bash -s <<DEPLOY_SCRIPT
  set -e

  # --- Deploy lock (prevents concurrent deploys) ---
  LOCKFILE="/tmp/fibreflow-deploy-${TARGET}.lock"
  if [ -f "\$LOCKFILE" ]; then
    LOCK_PID=\$(cat "\$LOCKFILE" 2>/dev/null | head -1)
    LOCK_AGE=\$(( \$(date +%s) - \$(stat -c %Y "\$LOCKFILE" 2>/dev/null || echo 0) ))
    if kill -0 "\$LOCK_PID" 2>/dev/null && [ "\$LOCK_AGE" -lt 600 ]; then
      echo "[deploy] ERROR: Another deploy to $TARGET is running (PID \$LOCK_PID, \${LOCK_AGE}s ago)"
      exit 1
    fi
    rm -f "\$LOCKFILE"
  fi
  echo \$\$ > "\$LOCKFILE"
  trap 'rm -f "\$LOCKFILE"' EXIT

  cd $DIR
  echo "[deploy] Directory: \$(pwd)"

  # Record current state
  CURRENT_COMMIT=\$(git rev-parse --short HEAD)
  echo "[deploy] Current commit: \$CURRENT_COMMIT"

  # Pull latest
  echo "[deploy] Pulling $BRANCH..."
  git fetch origin
  git checkout $BRANCH
  git pull origin $BRANCH

  NEW_COMMIT=\$(git rev-parse --short HEAD)
  echo "[deploy] New commit: \$NEW_COMMIT"

  if [ "\$CURRENT_COMMIT" = "\$NEW_COMMIT" ] && [ -f .next/BUILD_ID ]; then
    echo "[deploy] No new commits and build exists — nothing to deploy"
    exit 0
  fi

  # Install deps if package.json changed
  if git diff --name-only \$CURRENT_COMMIT HEAD | grep -q 'package.json' 2>/dev/null; then
    echo "[deploy] package.json changed, running npm install..."
    npm install
  fi

  # Stop service BEFORE touching .next (prevents 500s during build)
  echo "[deploy] Stopping $SVC..."
  echo '$SUDO_PASS' | sudo -S systemctl stop $SVC 2>/dev/null || true

  # Backup current build
  TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
  if [ -d .next ]; then
    echo "[deploy] Backing up current build..."
    mv .next .next-backup-\$TIMESTAMP
  fi

  # Build
  echo "[deploy] Building..."
  npm run build || {
    echo "[deploy] Build FAILED — restoring backup and restarting service"
    if [ -d .next-backup-\$TIMESTAMP ]; then
      mv .next-backup-\$TIMESTAMP .next
    fi
    echo '$SUDO_PASS' | sudo -S systemctl start $SVC 2>/dev/null || true
    exit 1
  }

  # Validate build
  if [ ! -f .next/BUILD_ID ]; then
    echo "[deploy] ERROR: BUILD_ID missing after build"
    exit 1
  fi
  echo "[deploy] Build validated (BUILD_ID: \$(cat .next/BUILD_ID))"

  # Start service (was stopped before build)
  echo "[deploy] Starting $SVC..."
  echo '$SUDO_PASS' | sudo -S systemctl start $SVC

  # Wait for startup
  sleep 5
  if ! systemctl is-active --quiet $SVC; then
    echo "[deploy] ERROR: Service failed to start"
    exit 1
  fi

  echo "[deploy] Service $SVC is active"

  # Clean old backups (keep last 3)
  ls -dt .next-backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

  # Log deployment
  mkdir -p logs
  echo "\$TIMESTAMP | \$CURRENT_COMMIT -> \$NEW_COMMIT | SUCCESS" >> logs/deploy-history.log

  echo "[deploy] DONE: \$CURRENT_COMMIT -> \$NEW_COMMIT"
DEPLOY_SCRIPT

DEPLOY_END=$(date +%s)
DEPLOY_DURATION=$((DEPLOY_END - DEPLOY_START))

# --- Post-deploy smoke tests ---
log "Running smoke tests for $TARGET..."
if [ -f "$SCRIPT_DIR/post-deploy-smoke.sh" ]; then
  ssh ${VELOCITY_USER}@${VELOCITY_HOST} "bash -s" < "$SCRIPT_DIR/post-deploy-smoke.sh" "$TARGET" || {
    warn "Smoke tests failed — check $URL manually"
  }
fi

# --- Summary ---
echo ""
echo -e "${BOLD}=== DEPLOYMENT COMPLETE ===${NC}"
echo -e "  Target:   ${GREEN}$TARGET${NC} ($URL)"
echo -e "  Branch:   $BRANCH"
echo -e "  Duration: ${DEPLOY_DURATION}s"
echo -e "  Time:     $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
echo "==========================="

exit 0
