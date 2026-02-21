#!/bin/bash
# =============================================================================
# emergency-ci-fallback.sh — Local Test Runner for FibreFlow
# =============================================================================
# Runs lint, type-check, and critical tests locally when GitHub Actions is down.
# Use this to validate code before deploying when CI is unavailable.
#
# Usage:
#   bash scripts/emergency-ci-fallback.sh
#   bash scripts/emergency-ci-fallback.sh --quick    # skip slow tests
#
# Exit code: 0 = all checks passed, 1 = failures detected
# =============================================================================

QUICK_MODE=false
for arg in "$@"; do
  [ "$arg" = "--quick" ] && QUICK_MODE=true
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

log_step() { echo -e "\n${BLUE}▶ $1${NC}"; }
log_pass() { echo -e "${GREEN}  ✅ $1${NC}"; PASS=$((PASS+1)); }
log_fail() { echo -e "${RED}  ❌ $1${NC}"; FAIL=$((FAIL+1)); }
log_skip() { echo -e "${YELLOW}  ⏭️  $1${NC}"; SKIP=$((SKIP+1)); }

echo "============================================="
echo "  FibreFlow Emergency CI Fallback"
echo "  Local Test Runner (no GitHub Actions)"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
if [ "$QUICK_MODE" = true ]; then
  echo "  Mode: QUICK (skip slow tests)"
fi
echo "============================================="

# Change to repo root
cd "$(dirname "$0")/.." || exit 1

# --- 1. Lint Check ---
log_step "ESLint (code quality)"
if npm run lint > /tmp/ci-lint.log 2>&1; then
  log_pass "ESLint passed"
else
  log_fail "ESLint failed — see /tmp/ci-lint.log"
  tail -20 /tmp/ci-lint.log | sed 's/^/       /'
fi

# --- 2. TypeScript Type Check ---
log_step "TypeScript type check"
if npm run type-check > /tmp/ci-typecheck.log 2>&1; then
  log_pass "TypeScript type check passed"
else
  log_fail "TypeScript type check failed — see /tmp/ci-typecheck.log"
  grep "error TS" /tmp/ci-typecheck.log | head -10 | sed 's/^/       /'
fi

# --- 3. Build Check ---
log_step "Next.js build (production)"
if [ "$QUICK_MODE" = true ]; then
  log_skip "Build skipped in quick mode"
else
  if npm run build > /tmp/ci-build.log 2>&1; then
    log_pass "Next.js build succeeded"
  else
    log_fail "Next.js build failed — see /tmp/ci-build.log"
    tail -30 /tmp/ci-build.log | sed 's/^/       /'
  fi
fi

# --- 4. Database Connection Check ---
log_step "Database connectivity"
if node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT 1 as test\`.then(() => {
  console.log('Database connection OK');
  process.exit(0);
}).catch(err => {
  console.error('Database connection FAILED:', err.message);
  process.exit(1);
});
" > /tmp/ci-db.log 2>&1; then
  log_pass "Database connection OK"
else
  log_fail "Database connection failed — check DATABASE_URL"
fi

# --- 5. Critical Endpoints Check ---
log_step "Critical endpoints (if server running)"
if curl -s --max-time 2 http://localhost:3000 > /dev/null 2>&1; then
  # Server is running, test endpoints
  if curl -s --max-time 3 http://localhost:3000/api/health | grep -q "healthy" 2>/dev/null; then
    log_pass "/api/health endpoint responding"
  else
    log_fail "/api/health endpoint not returning healthy status"
  fi
  
  if curl -s --max-time 3 http://localhost:3000/sign-in | grep -qi "sign.in\|email" 2>/dev/null; then
    log_pass "/sign-in page rendering"
  else
    log_fail "/sign-in page not rendering correctly"
  fi
else
  log_skip "Server not running (localhost:3000) — endpoint checks skipped"
fi

# --- SUMMARY ---
echo ""
echo "============================================="
echo "  EMERGENCY CI FALLBACK — SUMMARY"
echo "============================================="
echo "  ✅ Passed: $PASS"
echo "  ❌ Failed: $FAIL"
echo "  ⏭️  Skipped: $SKIP"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  ❌ CI FALLBACK FAILED — Do NOT deploy until issues are fixed.${NC}"
  echo ""
  echo "  Review logs:"
  echo "    /tmp/ci-lint.log"
  echo "    /tmp/ci-typecheck.log"
  echo "    /tmp/ci-build.log"
  echo "    /tmp/ci-db.log"
  exit 1
else
  echo -e "${GREEN}  ✅ ALL CHECKS PASSED — Code is safe to deploy.${NC}"
  if [ "$SKIP" -gt 0 ]; then
    echo -e "${YELLOW}  (Note: $SKIP checks were skipped)${NC}"
  fi
  exit 0
fi
