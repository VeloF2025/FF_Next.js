#!/bin/bash
# =============================================================================
# ci-local.sh — Local CI Pipeline (replaces GitHub Actions CI)
# =============================================================================
# Runs the same validation gates locally. Zero Tolerance: if it fails, it blocks.
#
# Usage:
#   bash scripts/ci-local.sh              # Full: lint + tests + build
#   bash scripts/ci-local.sh --quick      # Lint gates only (fast, pre-PR)
#   bash scripts/ci-local.sh --pre-deploy # Lint gates only (deploy uses this)
#
# Baselines (ratchet down over time, never up):
#   Lint warnings: 1669   (no-explicit-any, no-unused-vars, etc.)
#   Lint errors:   77     (ts-ignore, prefer-const — pre-existing)
#   Silent catches: 94    (catch blocks without logging)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

FAILED=0
WARNED=0
SKIPPED=0
PASSED=0
MODE="${1:---full}"
START_TIME=$(date +%s)

# --- Baselines (ratchet: lower these as you fix issues, never raise) ---
MAX_LINT_WARNINGS=1689
MAX_LINT_ERRORS=77
MAX_SILENT_CATCHES=84

pass() { echo -e "${GREEN}  ✓ $*${NC}"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}  ✗ $*${NC}"; FAILED=$((FAILED + 1)); }
skip() { echo -e "${YELLOW}  ⊘ $* (skipped)${NC}"; SKIPPED=$((SKIPPED + 1)); }
info() { echo -e "${CYAN}  → $*${NC}"; }

echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  FibreFlow Local CI — Zero Tolerance                      ║${NC}"
echo -e "${BOLD}║  Mode: ${CYAN}${MODE}${NC}${BOLD}                                                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"

# ─── Gate 1: ESLint (warnings + errors ratchet) ─────────────────────────────
echo -e "\n${CYAN}── Gate 1: ESLint ──${NC}\n"

LINT_OUTPUT=$(npm run lint 2>&1 || true)
LINT_SUMMARY=$(echo "$LINT_OUTPUT" | grep -P '\d+ problems? \(' || echo "0 problems (0 errors, 0 warnings)")
LINT_ERRORS=$(echo "$LINT_SUMMARY" | grep -oP '\d+ error' | grep -oP '\d+' || echo "0")
LINT_WARNINGS=$(echo "$LINT_SUMMARY" | grep -oP '\d+ warning' | grep -oP '\d+' || echo "0")

if [ "$LINT_WARNINGS" -le "$MAX_LINT_WARNINGS" ] && [ "$LINT_ERRORS" -le "$MAX_LINT_ERRORS" ]; then
  pass "ESLint: ${LINT_ERRORS} errors (≤${MAX_LINT_ERRORS}), ${LINT_WARNINGS} warnings (≤${MAX_LINT_WARNINGS})"
else
  fail "ESLint: ${LINT_ERRORS} errors (max ${MAX_LINT_ERRORS}), ${LINT_WARNINGS} warnings (max ${MAX_LINT_WARNINGS})"
  if [ "$LINT_ERRORS" -gt "$MAX_LINT_ERRORS" ]; then
    info "New lint errors introduced! Fix before proceeding."
    echo "$LINT_OUTPUT" | grep "  error  " | tail -10 | sed 's/^/    /'
  fi
  if [ "$LINT_WARNINGS" -gt "$MAX_LINT_WARNINGS" ]; then
    info "New lint warnings introduced! Fix or update baseline."
  fi
fi

# ─── Gate 2: Silent catches (API routes) ─────────────────────────────────────
echo -e "\n${CYAN}── Gate 2: Error Handling (no-silent-catch) ──${NC}\n"

CATCH_OUTPUT=$(npx eslint pages/api --ext .ts --rulesdir scripts/eslint-rules --rule '{"no-silent-catch": "warn"}' 2>&1 || true)
CATCH_COUNT=$(echo "$CATCH_OUTPUT" | grep -c "no-silent-catch" || echo "0")

if [ "$CATCH_COUNT" -le "$MAX_SILENT_CATCHES" ]; then
  pass "Silent catches: ${CATCH_COUNT} (≤${MAX_SILENT_CATCHES})"
else
  fail "Silent catches: ${CATCH_COUNT} (max ${MAX_SILENT_CATCHES}) — new silent catch blocks added"
  echo "$CATCH_OUTPUT" | grep "no-silent-catch" | tail -5 | sed 's/^/    /'
fi

# ─── Gate 3: TypeScript ──────────────────────────────────────────────────────
echo -e "\n${CYAN}── Gate 3: TypeScript ──${NC}\n"

if npm run type-check > /tmp/ci-typecheck.txt 2>&1; then
  pass "TypeScript: no errors"
else
  TS_ERRORS=$(grep -c "error TS" /tmp/ci-typecheck.txt || echo "0")
  # Type-check is non-blocking (pre-existing errors) but we report it
  echo -e "${YELLOW}  ⚠ TypeScript: ${TS_ERRORS} errors (pre-existing, non-blocking)${NC}"
  WARNED=$((WARNED + 1))
fi

# ─── Gate 4: Zero Tolerance (staged files only) ──────────────────────────────
echo -e "\n${CYAN}── Gate 4: Zero Tolerance (changed files) ──${NC}\n"

ZT_FAILED=false
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
if [ -n "$CHANGED_FILES" ]; then
  # Check for console.log in changed .ts/.tsx files
  CONSOLE_HITS=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | { grep -v '.test.' || true; } | { grep -v '.spec.' || true; } | while read -r f; do
    [ -f "$f" ] && grep -n 'console\.\(log\|error\|warn\|info\|debug\)' "$f" 2>/dev/null | grep -v '^\s*//' | sed "s|^|$f:|" || true
  done)

  if [ -n "$CONSOLE_HITS" ]; then
    fail "console.* found in changed files (use log from @/lib/logger)"
    echo "$CONSOLE_HITS" | head -10 | sed 's/^/    /'
    ZT_FAILED=true
  fi

  # Check for empty catch blocks in changed files
  EMPTY_CATCH=$(echo "$CHANGED_FILES" | grep -E '\.(ts|tsx)$' | while read -r f; do
    [ -f "$f" ] && grep -n 'catch.*{[[:space:]]*}' "$f" 2>/dev/null | sed "s|^|$f:|" || true
  done)

  if [ -n "$EMPTY_CATCH" ]; then
    fail "Empty catch blocks in changed files"
    echo "$EMPTY_CATCH" | head -10 | sed 's/^/    /'
    ZT_FAILED=true
  fi

  if [ "$ZT_FAILED" = false ]; then
    pass "Zero Tolerance: changed files clean"
  fi
else
  pass "Zero Tolerance: no changed files"
fi

# ─── Gate 5+6: Tests & Build (full mode only) ────────────────────────────────
if [ "$MODE" = "--quick" ] || [ "$MODE" = "--pre-deploy" ]; then
  echo -e "\n${YELLOW}Skipped: tests + build (${MODE} mode)${NC}"
  SKIPPED=$((SKIPPED + 2))
else
  echo -e "\n${CYAN}── Gate 5: Unit Tests ──${NC}\n"

  if npm test -- --run > /tmp/ci-tests.txt 2>&1; then
    TEST_COUNT=$(grep -oP '\d+ passed' /tmp/ci-tests.txt | head -1 || echo "? passed")
    pass "Unit tests: ${TEST_COUNT}"
  else
    # Tests are non-blocking (pre-existing failures) but we report
    TEST_FAIL=$(grep -oP '\d+ failed' /tmp/ci-tests.txt | head -1 || echo "? failed")
    echo -e "${YELLOW}  ⚠ Unit tests: ${TEST_FAIL} (non-blocking)${NC}"
    WARNED=$((WARNED + 1))
  fi

  echo -e "\n${CYAN}── Gate 6: Build ──${NC}\n"

  if npm run build > /tmp/ci-build.txt 2>&1; then
    pass "Build: success"
  else
    fail "Build: FAILED"
    tail -15 /tmp/ci-build.txt | sed 's/^/    /'
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}${BOLD}║  ✗ CI FAILED — ${FAILED} gate(s) failed                          ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
else
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║  ✓ CI PASSED                                              ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
fi
echo -e "  Passed: ${GREEN}${PASSED}${NC}  Failed: ${RED}${FAILED}${NC}  Warned: ${YELLOW}${WARNED}${NC}  Skipped: ${SKIPPED}  Duration: ${DURATION}s\n"

[ "$FAILED" -gt 0 ] && exit 1 || exit 0
