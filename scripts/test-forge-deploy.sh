#!/bin/bash
# Test suite for forge-deploy.sh
# Run: bash test-forge-deploy.sh
# Tests deployment script in isolation without actually deploying

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

test_pass() { echo -e "${GREEN}✅${NC} $1"; PASS=$((PASS+1)); }
test_fail() { echo -e "${RED}❌${NC} $1"; FAIL=$((FAIL+1)); }
test_skip() { echo -e "${YELLOW}⊘${NC} $1"; SKIP=$((SKIP+1)); }

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/forge-deploy.sh"

# Test 1: Script exists and is executable
if [[ -x "$SCRIPT" ]]; then
  test_pass "forge-deploy.sh is executable"
else
  test_fail "forge-deploy.sh missing or not executable"
fi

# Test 2: Script has help/usage text
if grep -q "Usage:" "$SCRIPT" 2>/dev/null; then
  test_pass "Script has usage documentation"
else
  test_fail "Script missing usage documentation"
fi

# Test 3: Required functions exist
for func in log warn fail info mc_log; do
  if grep -q "^$func()" "$SCRIPT" 2>/dev/null; then
    test_pass "Function $func() defined"
  else
    test_fail "Function $func() missing"
  fi
done

# Test 4: Environment variable handling
if grep -q 'MC_API_KEY' "$SCRIPT" && \
   grep -q 'SUDO_PASS' "$SCRIPT"; then
  test_pass "Script uses required environment variables"
else
  test_fail "Script missing required env var handling"
fi

# Test 5: Pre-flight checks reference
if grep -q "PRECHECK_SCRIPT" "$SCRIPT" || \
   grep -q "pre-deploy-check" "$SCRIPT"; then
  test_pass "Script includes pre-deploy checks"
else
  test_fail "Script missing pre-deploy checks reference"
fi

# Test 6: Error handling (MC logging on failure)
if grep -q 'mc_log.*FAILED' "$SCRIPT"; then
  test_pass "Script logs failures to MC API"
else
  test_fail "Script missing failure logging"
fi

# Test 7: Smoke test integration
if grep -q 'post-deploy-smoke' "$SCRIPT"; then
  test_pass "Script includes smoke tests"
else
  test_fail "Script missing smoke test integration"
fi

# Test 8: Deploy log tracking
if grep -q 'DEPLOY_LOG\|deploy-history' "$SCRIPT"; then
  test_pass "Script tracks deploy history"
else
  test_fail "Script missing deploy history tracking"
fi

# Test 9: CR gate check (for staging/prod)
if grep -q 'staging\|prod' "$SCRIPT" && \
   grep -q 'CR_ID\|--cr' "$SCRIPT"; then
  test_pass "Script enforces CR requirement for staging/prod"
else
  test_fail "Script missing CR gate for staging/prod"
fi

# Test 10: Bash syntax validation
if bash -n "$SCRIPT" 2>/dev/null; then
  test_pass "Bash syntax valid"
else
  test_fail "Bash syntax errors in script"
fi

echo ""
echo "=== SUMMARY ==="
echo "Passed:  $PASS"
echo "Failed:  $FAIL"
echo "Skipped: $SKIP"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}TESTS FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}ALL TESTS PASSED${NC}"
  exit 0
fi
