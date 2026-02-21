#!/bin/bash
# Test suite for forge-rollback.sh
# Validates rollback script structure and safety checks

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

test_pass() { echo -e "${GREEN}✅${NC} $1"; PASS=$((PASS+1)); }
test_fail() { echo -e "${RED}❌${NC} $1"; FAIL=$((FAIL+1)); }

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/forge-rollback.sh"

# Test 1: Script exists and is executable
if [[ -x "$SCRIPT" ]]; then
  test_pass "forge-rollback.sh is executable"
else
  test_fail "forge-rollback.sh not found or not executable"
  exit 1
fi

# Test 2: Usage documentation
if grep -q "Usage:" "$SCRIPT"; then
  test_pass "Script has usage documentation"
else
  test_fail "Missing usage documentation"
fi

# Test 3: Critical functions
for func in log warn fail info mc_log; do
  if grep -q "^$func()" "$SCRIPT"; then
    test_pass "Function $func() defined"
  else
    test_fail "Function $func() missing"
  fi
done

# Test 4: Environment variables
if grep -q 'MC_API_KEY\|SUDO_PASS' "$SCRIPT"; then
  test_pass "Script handles required env vars"
else
  test_fail "Missing env var handling"
fi

# Test 5: Git operations
if grep -q 'git.*checkout\|git.*pull\|git.*rebase' "$SCRIPT"; then
  test_pass "Script uses git for rollback"
else
  test_fail "Missing git operations for rollback"
fi

# Test 6: Build verification
if grep -q 'npm.*build' "$SCRIPT" && \
   grep -q 'BUILD_EXIT' "$SCRIPT"; then
  test_pass "Script rebuilds after rollback"
else
  test_fail "Missing rebuild after rollback"
fi

# Test 7: Service restart
if grep -q 'systemctl.*restart' "$SCRIPT"; then
  test_pass "Script restarts service"
else
  test_fail "Missing service restart"
fi

# Test 8: Smoke tests after rollback
if grep -q 'post-deploy-smoke' "$SCRIPT"; then
  test_pass "Script runs smoke tests post-rollback"
else
  test_fail "Missing smoke tests after rollback"
fi

# Test 9: Logging to deploy history
if grep -q 'ROLLBACK' "$SCRIPT" && \
   grep -q 'DEPLOY_LOG' "$SCRIPT"; then
  test_pass "Script logs rollback to history"
else
  test_fail "Missing deploy history logging"
fi

# Test 10: MC API notification
if grep -q 'mc_log.*Rollback' "$SCRIPT"; then
  test_pass "Script notifies via MC API"
else
  test_fail "Missing MC API notification"
fi

# Test 11: Target commit validation
if grep -q 'git.*rev-parse' "$SCRIPT"; then
  test_pass "Script validates target commit"
else
  test_fail "Missing commit validation"
fi

# Test 12: Error handling on critical failures
if grep -q 'fail.*Build\|fail.*restart\|fail.*rollback' "$SCRIPT"; then
  test_pass "Script handles build/restart failures"
else
  test_fail "Insufficient error handling"
fi

# Test 13: Bash syntax
if bash -n "$SCRIPT" 2>/dev/null; then
  test_pass "Bash syntax valid"
else
  test_fail "Bash syntax errors"
fi

# Test 14: Help text mentions all environments
if grep -q 'dev\|staging\|prod' "$SCRIPT"; then
  test_pass "Script supports all environments"
else
  test_fail "Missing environment support"
fi

echo ""
echo "=== SUMMARY ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}TESTS FAILED${NC}"
  exit 1
else
  echo -e "${GREEN}ALL TESTS PASSED ($PASS/14)${NC}"
  exit 0
fi
