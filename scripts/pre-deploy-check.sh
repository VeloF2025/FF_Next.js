#!/bin/bash
# =============================================================================
# pre-deploy-check.sh — Deployment Safety Checks for FibreFlow
# =============================================================================
# Validates environment before deploying to production, staging, or dev.
# Catches zombie processes, port conflicts, stale PIDs, and build readiness.
#
# Usage:
#   bash scripts/pre-deploy-check.sh [prod|staging|dev]
#   bash scripts/pre-deploy-check.sh          # defaults to production
#
# Exit code: 0 = safe to deploy, 1 = issues found (do NOT deploy)
# =============================================================================

ENV="${1:-prod}"

case "$ENV" in
  prod|production) PORT=3000; SVC="fibreflow-production"; URL="https://app.fibreflow.app"; DIR="/home/velo/fibreflow-production" ;;
  staging|stg)     PORT=3006; SVC="fibreflow";            URL="https://vf.fibreflow.app";  DIR="/home/velo/fibreflow-staging"   ;;
  dev)             PORT=3005; SVC="fibreflow-dev";        URL="https://dev.fibreflow.app"; DIR="/home/velo/fibreflow-dev"       ;;
  *)               echo "Unknown env: $ENV. Use prod|staging|dev"; exit 1 ;;
esac

PASS=0
FAIL=0
WARN=0
RESULTS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "\n${BLUE}▶ $1${NC}"; }
log_pass() { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS+1)); RESULTS+=("✅ $1"); }
log_fail() { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL+1)); RESULTS+=("❌ $1"); }
log_warn() { echo -e "${YELLOW}  ⚠️  $1${NC}"; WARN=$((WARN+1)); RESULTS+=("⚠️  $1"); }

echo "============================================="
echo "  FibreFlow Pre-Deploy Check — $ENV"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "============================================="
echo "  Port: $PORT | Service: $SVC"
echo ""

# --- CHECK 1: Build exists ---
log_step "Build verification"
if [ -d "$DIR/.next" ] && [ -f "$DIR/.next/BUILD_ID" ]; then
  BUILD_ID=$(cat "$DIR/.next/BUILD_ID" 2>/dev/null)
  BUILD_AGE_MINS=$(( ( $(date +%s) - $(stat -c %Y "$DIR/.next/BUILD_ID") ) / 60 ))
  log_pass "Build exists — ID: $BUILD_ID (${BUILD_AGE_MINS} min old)"
  if [ "$BUILD_AGE_MINS" -gt 120 ]; then
    log_warn "Build is ${BUILD_AGE_MINS} min old — consider rebuilding"
  fi
else
  log_fail "No build found at $DIR/.next — run npm run build first"
fi

# --- CHECK 2: Disk space ---
log_step "Disk space"
DISK_PCT=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_PCT" -lt 85 ]; then
  log_pass "Disk: ${DISK_PCT}% used"
elif [ "$DISK_PCT" -lt 95 ]; then
  log_warn "Disk: ${DISK_PCT}% used — getting full"
else
  log_fail "Disk: ${DISK_PCT}% used — CRITICAL, do not deploy"
fi

# --- CHECK 3: Port conflict detection ---
log_step "Port conflict check (port $PORT)"
PORT_PIDS=$(lsof -ti :$PORT 2>/dev/null || true)
if [ -z "$PORT_PIDS" ]; then
  log_pass "Port $PORT is free"
else
  PROC_COUNT=$(echo "$PORT_PIDS" | wc -l | tr -d ' ')
  # Check if it's the expected service
  EXPECTED_PID=$(systemctl show $SVC --property=MainPID 2>/dev/null | cut -d= -f2)
  if echo "$PORT_PIDS" | grep -q "^${EXPECTED_PID}$"; then
    log_pass "Port $PORT held by $SVC (expected, PID $EXPECTED_PID)"
  else
    log_warn "Port $PORT held by $PROC_COUNT process(es): PIDs $PORT_PIDS — may conflict on restart"
  fi
fi

# --- CHECK 4: Zombie/orphan process detection ---
log_step "Zombie process check"
ZOMBIES=$(ps aux | awk '$8 == "Z" {print $2, $11}' | head -5)
if [ -z "$ZOMBIES" ]; then
  log_pass "No zombie processes"
else
  log_warn "Zombie processes detected: $ZOMBIES"
fi

# Check for orphan node processes on this port
ORPHANS=$(ps aux | grep "next.*$PORT" | grep -v grep | grep -v "systemd" | awk '{print $2, $11}' | head -5)
if [ -z "$ORPHANS" ]; then
  log_pass "No orphan node processes on port $PORT"
else
  log_warn "Possible orphan processes: $ORPHANS"
fi

# --- CHECK 5: Service state ---
log_step "Service state"
SVC_STATE=$(systemctl is-active "$SVC" 2>/dev/null; true)
SVC_STATE="${SVC_STATE:-unknown}"
if [ "$SVC_STATE" = "active" ]; then
  log_pass "Service $SVC is active"
elif [ "$SVC_STATE" = "failed" ]; then
  log_fail "Service $SVC is in FAILED state — check journalctl -u $SVC"
elif [ "$SVC_STATE" = "activating" ]; then
  log_warn "Service $SVC is still activating — wait before deploying"
else
  log_warn "Service $SVC state: $SVC_STATE"
fi

# --- CHECK 6: Memory headroom ---
log_step "Memory headroom"
MEM_FREE_MB=$(free -m | awk '/Mem:/ {print $7}')
if [ "$MEM_FREE_MB" -gt 2000 ]; then
  log_pass "Available memory: ${MEM_FREE_MB}MB"
elif [ "$MEM_FREE_MB" -gt 500 ]; then
  log_warn "Available memory: ${MEM_FREE_MB}MB — low"
else
  log_fail "Available memory: ${MEM_FREE_MB}MB — critically low"
fi

# --- CHECK 7: Load average ---
log_step "Load average"
LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk -F',' '{print $1}' | tr -d ' ')
LOAD_INT=$(echo "$LOAD" | cut -d. -f1)
if [ "$LOAD_INT" -lt 8 ]; then
  log_pass "Load average: $LOAD"
elif [ "$LOAD_INT" -lt 20 ]; then
  log_warn "Load average: $LOAD — elevated"
else
  log_fail "Load average: $LOAD — system under heavy load, delay deploy"
fi

# --- SUMMARY ---
echo ""
echo "============================================="
echo "  SUMMARY — $ENV"
echo "============================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  Passed:   $PASS"
echo "  Warnings: $WARN"
echo "  Failed:   $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  ❌ PRE-DEPLOY CHECK FAILED — Resolve issues before deploying.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}  ⚠️  PRE-DEPLOY WARNINGS — Review before deploying.${NC}"
  exit 0
else
  echo -e "${GREEN}  ✅ ALL CHECKS PASSED — Safe to deploy.${NC}"
  exit 0
fi
