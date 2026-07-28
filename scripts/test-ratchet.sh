#!/usr/bin/env bash
#
# Unit-test ratchet — tolerate today's known failures, fail on any NEW one.
#
# Why this exists: the CI unit-test step used to be `continue-on-error: true`,
# so a failing test — or a run killed mid-flight — reported green. On
# 2026-07-28 that hid the fact the suite never terminated at all: one test file
# deadlocked on fake timers vs testing-library's `waitFor`, CI killed the run at
# its 5-minute cap, and the kill was reported as success. The step had never
# once produced a real test result.
#
# Deleting `continue-on-error` outright was not an option: the suite carries 56
# genuinely failing tests. Blocking on those would have stopped every merge in
# the repo. So this ratchets instead, the same way the lint gate does
# (`MAX_LINT_WARNINGS`) — today's count passes, one more fails.
#
# Drive the baselines DOWN as failures get fixed. Never raise them to make a red
# build green: that is the habit this script exists to break.
#
# Usage:  bash scripts/test-ratchet.sh
# Exit:   0 = at or below baseline, 1 = regression (or the run did not complete)

set -uo pipefail

# ── Baselines ────────────────────────────────────────────────────────────────
# 2026-07-28: established at master 62ffc71e8, immediately after fixing the
# WorkflowEditor.test.tsx fake-timer deadlock. First run in this repo's history
# where the suite actually completed: 40s wall, 628 files, 7179 tests.
#   56 failing tests across 8 files:
#     ContractorImport 18, noc/tickets 20, WorkflowEditor 6,
#     returns-accept-hardening 5, dashboardService 2, pp-data-gps-backfill 2,
#     returns-flow-integration 2, no-direct-db-connections 1
#   10 further files fail to COLLECT (0 tests run) — missing TEST_DATABASE_URL,
#     a vi.mock hoisting error, `jest is not defined`, and similar.
MAX_FAILING_TESTS=56
MAX_FAILING_FILES=18

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

OUTPUT_FILE="${TMPDIR:-/tmp}/vitest-ratchet-$$.txt"
trap 'rm -f "$OUTPUT_FILE"' EXIT

echo "Running unit tests (ratchet: ≤${MAX_FAILING_TESTS} failing tests, ≤${MAX_FAILING_FILES} failing files)…"

# Runs the suite and sets failing_tests / failing_files. Returns 1 only when the
# run produced no summary at all (hang, crash, timeout kill).
run_suite() {
  # Do not let a non-zero exit abort the script — a failing suite is exactly the
  # case being measured. Completeness is judged from the summary, not the exit
  # code.
  npm test -- --run --reporter=basic > "$OUTPUT_FILE" 2>&1 || true

  # vitest prints, e.g.:
  #   Test Files  18 failed | 595 passed | 15 skipped (628)
  #        Tests  56 failed | 6763 passed | 360 skipped (7179)
  tests_line=$(grep -E '^ *Tests +[0-9]+' "$OUTPUT_FILE" | tail -1)
  files_line=$(grep -E '^ *Test Files +[0-9]+' "$OUTPUT_FILE" | tail -1)

  # A hung, killed or crashed run emits no summary. That MUST fail: treating a
  # missing summary as "no failures" is precisely how the old setup reported a
  # 5-minute timeout kill as success.
  if [ -z "$tests_line" ] || [ -z "$files_line" ]; then
    echo -e "${RED}✗ Unit tests: no summary line — the run did not complete.${NC}"
    echo "  A hang, crash or timeout kill lands here. It is NOT treated as a pass."
    echo "  Last 25 lines:"
    tail -25 "$OUTPUT_FILE" | sed 's/^/    /'
    return 1
  fi

  # "N failed" is absent entirely when nothing failed, so default to 0.
  failing_tests=$(grep -oE '[0-9]+ failed' <<<"$tests_line" | grep -oE '[0-9]+' | head -1)
  failing_files=$(grep -oE '[0-9]+ failed' <<<"$files_line" | grep -oE '[0-9]+' | head -1)
  failing_tests=${failing_tests:-0}
  failing_files=${failing_files:-0}

  echo "  ${files_line# }"
  echo "  ${tests_line# }"
  return 0
}

over_baseline() {
  [ "$failing_tests" -gt "$MAX_FAILING_TESTS" ] || [ "$failing_files" -gt "$MAX_FAILING_FILES" ]
}

run_suite || exit 1

# Flake guard. The suite is *mostly* deterministic — three consecutive runs on
# an idle box gave exactly 56 each time — but one run in roughly six came back
# 57, and this runner is single-concurrency and shared with the production
# service, so a run competing with a `next build` can time tests out. Only
# re-run when we are about to fail, so the happy path costs nothing, and require
# BOTH runs to exceed the baseline. A real regression fails twice; a flake does
# not. If this starts firing often, find the flaky test rather than raising the
# baseline.
if over_baseline; then
  echo -e "${YELLOW}  over baseline (${failing_tests} tests / ${failing_files} files) — re-running once to rule out load flake…${NC}"
  run_suite || exit 1
fi

if over_baseline; then
  echo -e "${RED}✗ Unit tests REGRESSED${NC}"
  echo "    failing tests: ${failing_tests} (baseline ${MAX_FAILING_TESTS})"
  echo "    failing files: ${failing_files} (baseline ${MAX_FAILING_FILES})"
  echo "  Fix the new failure(s). Do not raise the baseline to go green."
  echo ""
  grep -E '^ *(FAIL|×)' "$OUTPUT_FILE" | head -30 | sed 's/^/    /'
  exit 1
fi

if [ "$failing_tests" -lt "$MAX_FAILING_TESTS" ] || [ "$failing_files" -lt "$MAX_FAILING_FILES" ]; then
  echo -e "${YELLOW}↓ Below baseline — lower it in scripts/test-ratchet.sh to lock the gain in:${NC}"
  echo "    MAX_FAILING_TESTS=${failing_tests}   MAX_FAILING_FILES=${failing_files}"
fi

echo -e "${GREEN}✓ Unit tests: ${failing_tests} failing (≤${MAX_FAILING_TESTS}), ${failing_files} files (≤${MAX_FAILING_FILES})${NC}"
exit 0
