#!/bin/bash
# =============================================================================
# post-deploy-smoke.sh — Post-Deploy Smoke Tests for FibreFlow
# =============================================================================
# Verifies a FibreFlow environment is healthy after deployment.
# Checks HTTP 200 on key endpoints, response time < 5s.
#
# Usage:
#   bash scripts/post-deploy-smoke.sh [prod|dev]
#   bash scripts/post-deploy-smoke.sh          # defaults to prod
#
# Exit code: 0 = healthy, 1 = smoke test failed
# =============================================================================

ENV="${1:-prod}"

case "$ENV" in
  prod|production) BASE_URL="https://app.fibreflow.app";  LOCAL_PORT=3000 ;;
  dev)             BASE_URL="https://dev.fibreflow.app";   LOCAL_PORT=3005 ;;
  *)               echo "Unknown env: $ENV. Use prod|dev"; exit 1 ;;
esac

PASS=0
FAIL=0
RESULTS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "\n${BLUE}▶ $1${NC}"; }
log_pass() { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS+1)); RESULTS+=("✅ $1"); }
log_fail() { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL+1)); RESULTS+=("❌ $1"); }

check_endpoint() {
  local label="$1"
  local url="$2"
  local expect_status="${3:-200}"

  local start_ms=$(date +%s%3N)
  local response
  response=$(curl -s -o /tmp/smoke_body -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
  local end_ms=$(date +%s%3N)
  local elapsed=$((end_ms - start_ms))

  if [ "$response" = "$expect_status" ] && [ "$elapsed" -lt 5000 ]; then
    log_pass "$label — HTTP $response in ${elapsed}ms"
  elif [ "$response" != "$expect_status" ]; then
    log_fail "$label — HTTP $response (expected $expect_status)"
  else
    log_fail "$label — HTTP $response but slow: ${elapsed}ms (>5000ms)"
  fi
}

echo "============================================="
echo "  FibreFlow Post-Deploy Smoke Tests — $ENV"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "  URL: $BASE_URL"
echo "============================================="

# Wait for service to come up (max 60s)
log_step "Waiting for service on port $LOCAL_PORT"
WAITED=0
while ! curl -s --max-time 2 "http://localhost:$LOCAL_PORT" > /dev/null 2>&1; do
  if [ $WAITED -ge 60 ]; then
    log_fail "Service did not respond on port $LOCAL_PORT within 60s"
    echo ""
    echo -e "${RED}  ❌ SMOKE TEST ABORTED — Service not up.${NC}"
    exit 1
  fi
  sleep 2
  WAITED=$((WAITED+2))
done
log_pass "Service responding on port $LOCAL_PORT (waited ${WAITED}s)"

# --- Endpoint checks ---
log_step "Endpoint health checks"
check_endpoint "Sign-in page"    "$BASE_URL/sign-in"
check_endpoint "Root redirect"   "$BASE_URL"
check_endpoint "API health"      "$BASE_URL/api/health"
check_endpoint "Local sign-in"   "http://localhost:$LOCAL_PORT/sign-in"
check_endpoint "Local API health" "http://localhost:$LOCAL_PORT/api/health"

# --- Content check on sign-in ---
log_step "Content validation"
SIGNIN_BODY=$(curl -s --max-time 5 "$BASE_URL/sign-in" 2>/dev/null)
if echo "$SIGNIN_BODY" | grep -qi "fibreflow\|sign.in\|email\|login" 2>/dev/null; then
  log_pass "Sign-in page contains expected content"
else
  log_fail "Sign-in page missing expected content (got blank or error page?)"
fi

# Check API health returns JSON
HEALTH_BODY=$(curl -s --max-time 5 "$BASE_URL/api/health" 2>/dev/null)
if echo "$HEALTH_BODY" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null; then
  log_pass "API health returns valid JSON"
else
  log_fail "API health did not return valid JSON"
fi

# --- SUMMARY ---
echo ""
echo "============================================="
echo "  SUMMARY — $ENV"
echo "============================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  Passed: $PASS  |  Failed: $FAIL"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  ❌ SMOKE TEST FAILED — Investigate before marking deploy complete.${NC}"
  exit 1
else
  echo -e "${GREEN}  ✅ ALL SMOKE TESTS PASSED — Deploy verified healthy.${NC}"
  exit 0
fi
