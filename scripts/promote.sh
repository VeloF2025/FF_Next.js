#!/bin/bash
# =============================================================================
# promote.sh — Environment Promotion Pipeline for FibreFlow
# =============================================================================
# Promotes a tested commit from one environment to the next.
# Ensures the EXACT commit running on source is deployed to target.
#
# Promotion paths:
#   dev → staging       (promote tested dev build to staging)
#   staging → production (promote verified staging build to production)
#
# Usage:
#   bash scripts/promote.sh dev staging          # Promote dev → staging
#   bash scripts/promote.sh staging production   # Promote staging → production
#   bash scripts/promote.sh dev staging --force  # Emergency (skips time gate)
#
# Safety:
#   - Verifies source environment is healthy before promoting
#   - Deploys the EXACT commit from source (not latest master)
#   - Runs smoke tests on target after promotion
#   - Blocked during business hours unless --force
#
# Exit code: 0 = success, 1 = blocked or failed
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VELOCITY_HOST="100.96.203.105"
VELOCITY_USER="velo"
SUDO_PASS="velo2026"
TIMEZONE="Africa/Johannesburg"

declare -A ENV_CONFIG=(
  [dev]="fibreflow-dev|3005|/home/velo/fibreflow-dev|https://dev.fibreflow.app"
  [staging]="fibreflow|3006|/home/velo/fibreflow-staging|https://vf.fibreflow.app"
  [production]="fibreflow-production|3000|/home/velo/fibreflow-production|https://app.fibreflow.app"
)

# Valid promotion paths (source → target)
declare -A VALID_PROMOTIONS=(
  ["dev:staging"]=1
  ["staging:production"]=1
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
SOURCE="${1:-}"
TARGET="${2:-}"
FORCE=false

shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force|-f) FORCE=true; shift ;;
    *)          shift ;;
  esac
done

# --- Validate arguments ---
if [ -z "$SOURCE" ] || [ -z "$TARGET" ]; then
  echo "Usage: promote.sh <source> <target> [--force]"
  echo ""
  echo "Promotion paths:"
  echo "  promote.sh dev staging          # Promote dev build to staging"
  echo "  promote.sh staging production   # Promote staging build to production"
  echo ""
  echo "Options:"
  echo "  --force    Skip business hours check (emergencies only)"
  exit 1
fi

if [ -z "${VALID_PROMOTIONS["$SOURCE:$TARGET"]}" ]; then
  error "Invalid promotion path: $SOURCE -> $TARGET. Valid paths: dev->staging, staging->production"
fi

if [ -z "${ENV_CONFIG[$SOURCE]}" ] || [ -z "${ENV_CONFIG[$TARGET]}" ]; then
  error "Unknown environment. Valid: dev, staging, production"
fi

IFS='|' read -r SRC_SVC SRC_PORT SRC_DIR SRC_URL <<< "${ENV_CONFIG[$SOURCE]}"
IFS='|' read -r TGT_SVC TGT_PORT TGT_DIR TGT_URL <<< "${ENV_CONFIG[$TARGET]}"

# --- Business hours check ---
is_business_hours() {
  local hour day_of_week
  hour=$(TZ=$TIMEZONE date +%H)
  day_of_week=$(TZ=$TIMEZONE date +%u)
  if [ "$day_of_week" -le 5 ] && [ "$hour" -ge 8 ] && [ "$hour" -lt 17 ]; then
    return 0
  fi
  return 1
}

echo ""
echo -e "${BOLD}=== FibreFlow Promotion ===${NC}"
echo -e "  From:  ${CYAN}$SOURCE${NC} ($SRC_URL)"
echo -e "  To:    ${BOLD}$TARGET${NC} ($TGT_URL)"
echo -e "  Time:  $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
echo ""

if is_business_hours; then
  if [ "$FORCE" = true ]; then
    warn "EMERGENCY — Promoting to $TARGET during business hours"
    read -p "Type 'EMERGENCY' to confirm: " -r
    if [ "$REPLY" != "EMERGENCY" ]; then
      error "Promotion cancelled"
    fi
  else
    echo -e "${RED}  BLOCKED: Cannot promote to $TARGET during business hours (08:00-17:00 SAST)${NC}"
    echo ""
    echo "  People are actively using $TGT_URL."
    echo "  Run this after 17:00 SAST or use --force for emergencies."
    echo ""
    exit 1
  fi
fi

# --- Step 1: Verify source health ---
log "Step 1: Verifying $SOURCE is healthy..."

SRC_COMMIT=$(ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
  "cd $SRC_DIR && git rev-parse HEAD" 2>/dev/null) || error "Cannot read $SOURCE commit"

SRC_COMMIT_SHORT="${SRC_COMMIT:0:8}"

SRC_STATUS=$(ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
  "systemctl is-active $SRC_SVC 2>/dev/null" 2>/dev/null || echo "unknown")

if [ "$SRC_STATUS" != "active" ]; then
  error "$SOURCE service ($SRC_SVC) is $SRC_STATUS — cannot promote from unhealthy source"
fi

SRC_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$SRC_URL/sign-in" 2>/dev/null || echo "000")
if [ "$SRC_HTTP" != "200" ]; then
  error "$SOURCE HTTP check failed (got $SRC_HTTP) — cannot promote from unhealthy source"
fi

log "Source $SOURCE is healthy (commit: $SRC_COMMIT_SHORT, service: active, HTTP: 200)"

# --- Step 2: Check target current state ---
log "Step 2: Checking $TARGET current state..."

TGT_COMMIT=$(ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
  "cd $TGT_DIR && git rev-parse --short HEAD" 2>/dev/null || echo "unknown")

info "Target $TARGET is currently on commit: $TGT_COMMIT"

if [ "$TGT_COMMIT" = "$SRC_COMMIT_SHORT" ]; then
  log "Target is already on the same commit as source — nothing to promote"
  exit 0
fi

# --- Step 3: Deploy exact source commit to target ---
log "Step 3: Deploying commit $SRC_COMMIT_SHORT to $TARGET..."
PROMOTE_START=$(date +%s)

ssh ${VELOCITY_USER}@${VELOCITY_HOST} bash -s <<PROMOTE_SCRIPT
  set -e

  cd $TGT_DIR
  echo "[promote] Target directory: \$(pwd)"

  # Record current state
  OLD_COMMIT=\$(git rev-parse --short HEAD)
  echo "[promote] Current target commit: \$OLD_COMMIT"
  echo "[promote] Promoting to: $SRC_COMMIT_SHORT"

  # Fetch and checkout EXACT commit from source
  git fetch origin
  git checkout $SRC_COMMIT || {
    echo "[promote] ERROR: Cannot checkout commit $SRC_COMMIT"
    exit 1
  }

  # Check if deps changed
  if git diff --name-only \$OLD_COMMIT HEAD | grep -q 'package.json' 2>/dev/null; then
    echo "[promote] package.json changed, running npm install..."
    npm install
  fi

  # Backup current build
  TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
  if [ -d .next ]; then
    echo "[promote] Backing up current build..."
    mv .next .next-backup-\$TIMESTAMP
  fi

  # Build
  echo "[promote] Building..."
  npm run build || {
    echo "[promote] Build FAILED — restoring backup"
    if [ -d .next-backup-\$TIMESTAMP ]; then
      mv .next-backup-\$TIMESTAMP .next
    fi
    exit 1
  }

  # Validate build
  if [ ! -f .next/BUILD_ID ]; then
    echo "[promote] ERROR: BUILD_ID missing"
    exit 1
  fi
  echo "[promote] Build validated (BUILD_ID: \$(cat .next/BUILD_ID))"

  # Restart service
  echo "[promote] Restarting $TGT_SVC..."
  echo '$SUDO_PASS' | sudo -S systemctl restart $TGT_SVC

  # Wait for startup
  sleep 5
  if ! systemctl is-active --quiet $TGT_SVC; then
    echo "[promote] ERROR: Service failed to start"
    exit 1
  fi
  echo "[promote] Service $TGT_SVC is active"

  # Clean old backups (keep last 3)
  ls -dt .next-backup-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

  # Log promotion
  mkdir -p logs
  echo "\$TIMESTAMP | PROMOTE $SOURCE->$TARGET | \$OLD_COMMIT -> $SRC_COMMIT_SHORT | SUCCESS" >> logs/deploy-history.log

  echo "[promote] DONE: \$OLD_COMMIT -> $SRC_COMMIT_SHORT"
PROMOTE_SCRIPT

PROMOTE_END=$(date +%s)
PROMOTE_DURATION=$((PROMOTE_END - PROMOTE_START))

# --- Step 4: Smoke test target ---
log "Step 4: Running smoke tests on $TARGET..."

TGT_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$TGT_URL/sign-in" 2>/dev/null || echo "000")
if [ "$TGT_HTTP" = "200" ]; then
  log "Smoke test passed (HTTP 200 on $TGT_URL)"
else
  warn "Smoke test concern: HTTP $TGT_HTTP on $TGT_URL — check manually"
fi

# --- Step 5: Verify commit matches ---
FINAL_COMMIT=$(ssh -o ConnectTimeout=5 ${VELOCITY_USER}@${VELOCITY_HOST} \
  "cd $TGT_DIR && git rev-parse --short HEAD" 2>/dev/null || echo "unknown")

if [ "$FINAL_COMMIT" = "$SRC_COMMIT_SHORT" ]; then
  log "Commit verification passed: $TARGET is on $FINAL_COMMIT (matches $SOURCE)"
else
  warn "Commit mismatch: expected $SRC_COMMIT_SHORT, got $FINAL_COMMIT"
fi

# --- Summary ---
echo ""
echo -e "${BOLD}=== PROMOTION COMPLETE ===${NC}"
echo -e "  Path:     ${CYAN}$SOURCE${NC} -> ${GREEN}$TARGET${NC}"
echo -e "  Commit:   $SRC_COMMIT_SHORT"
echo -e "  Target:   $TGT_URL"
echo -e "  Duration: ${PROMOTE_DURATION}s"
echo -e "  Time:     $(TZ=$TIMEZONE date '+%Y-%m-%d %H:%M %Z')"
echo "=========================="

exit 0
