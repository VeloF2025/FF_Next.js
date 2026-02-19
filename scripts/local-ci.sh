#!/bin/bash
# =============================================================================
# local-ci.sh — Emergency CI Fallback for FibreFlow
# =============================================================================
# Runs lint, type-check, and critical unit tests locally without GitHub Actions.
# Use when GitHub Actions is unavailable (billing failure, outage, etc.)
#
# Usage:
#   bash scripts/local-ci.sh              # full run
#   bash scripts/local-ci.sh --fast       # lint + typecheck only (no tests)
#   bash scripts/local-ci.sh --tests-only # tests only
#
# Output: pass/fail per step + summary
# Exit code: 0 = all passed, 1 = one or more failures
# =============================================================================

set -euo pipefail

FAST_MODE=false
TESTS_ONLY=false

for arg in "$@"; do
  case $arg in
    --fast)       FAST_MODE=true ;;
    --tests-only) TESTS_ONLY=true ;;
  esac
done

PASS=0
FAIL=0
SKIPPED=0
RESULTS=()

cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_step() { echo -e "\n${BLUE}▶ $1${NC}"; }
log_pass() { echo -e "${GREEN}✅ $1${NC}"; PASS=$((PASS+1)); RESULTS+=("✅ $1"); }
log_fail() { echo -e "${RED}❌ $1${NC}"; FAIL=$((FAIL+1)); RESULTS+=("❌ $1"); }
log_skip() { echo -e "${YELLOW}⏭  $1${NC}"; SKIPPED=$((SKIPPED+1)); RESULTS+=("⏭  $1"); }

echo "============================================="
echo "  FibreFlow Local CI — $(date '+%Y-%m-%d %H:%M %Z')"
echo "============================================="
echo "Mode: $([ "$FAST_MODE" = true ] && echo 'fast (lint+types)' || ([ "$TESTS_ONLY" = true ] && echo 'tests-only' || echo 'full'))"
echo "Branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
echo "Commit: $(git log -1 --format='%h %s' 2>/dev/null || echo 'unknown')"
echo ""

# --- STEP 1: ESLint ---
if [ "$TESTS_ONLY" = false ]; then
  log_step "ESLint"
  if npm run lint -- --max-warnings 50 2>&1 | tail -5; then
    log_pass "Lint"
  else
    log_fail "Lint"
  fi
fi

# --- STEP 2: TypeScript ---
if [ "$TESTS_ONLY" = false ]; then
  log_step "TypeScript type-check"
  if npm run type-check 2>&1 | tail -10; then
    log_pass "TypeScript"
  else
    log_fail "TypeScript"
  fi
fi

if [ "$FAST_MODE" = true ]; then
  log_skip "Unit tests (--fast mode)"
  log_skip "Component tests (--fast mode)"
else
  # --- STEP 3: Unit tests (fast, no DB) ---
  log_step "Unit tests (utils + helpers)"
  if npx vitest run src/utils 2>&1 | tail -10; then
    log_pass "Unit tests"
  else
    log_fail "Unit tests"
  fi

  # --- STEP 4: Component tests ---
  log_step "Component tests"
  if npm run test:component 2>&1 | tail -10; then
    log_pass "Component tests"
  else
    log_fail "Component tests"
  fi

  # --- STEP 5: No-direct-DB check ---
  log_step "No direct DB connections check"
  if npx vitest run src/tests/no-direct-db-connections.test.ts 2>&1 | tail -5; then
    log_pass "No direct DB connections"
  else
    log_fail "No direct DB connections"
  fi
fi

# --- SUMMARY ---
echo ""
echo "============================================="
echo "  SUMMARY"
echo "============================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  Passed:  $PASS"
echo "  Failed:  $FAIL"
echo "  Skipped: $SKIPPED"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}  ❌ LOCAL CI FAILED — Do not deploy.${NC}"
  exit 1
else
  echo -e "${GREEN}  ✅ LOCAL CI PASSED — Safe to deploy.${NC}"
  exit 0
fi
