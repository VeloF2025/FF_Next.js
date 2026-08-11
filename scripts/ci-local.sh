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
# Baselines (ratchet down over time, never up) live in scripts/ci-baselines.env
# — the single source of truth, sourced below. Do not restate the numbers here;
# scripts/check-ci-baselines.mjs fails the build on any copy that disagrees.
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

# --- Baselines: single source of truth, with the full provenance log ---
# Sourced rather than restated so this file cannot drift from the deploy gate,
# the GitHub Actions gate, or /auto-improve — which is exactly what happened
# before 2026-08-09, when five declarations held five different values.
CI_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$CI_SCRIPT_DIR/ci-baselines.env" ]; then
  echo "FATAL: missing $CI_SCRIPT_DIR/ci-baselines.env — cannot verify any ratchet gate" >&2
  exit 1
fi
# shellcheck source=scripts/ci-baselines.env
. "$CI_SCRIPT_DIR/ci-baselines.env"
: "${MAX_LINT_WARNINGS:?not set by ci-baselines.env}"
: "${MAX_LINT_ERRORS:?not set by ci-baselines.env}"
: "${MAX_PAGES_LINT_WARNINGS:?not set by ci-baselines.env}"
: "${MAX_PAGES_LINT_ERRORS:?not set by ci-baselines.env}"
: "${MAX_SILENT_CATCHES:?not set by ci-baselines.env}"

pass() { echo -e "${GREEN}  ✓ $*${NC}"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}  ✗ $*${NC}"; FAILED=$((FAILED + 1)); }
skip() { echo -e "${YELLOW}  ⊘ $* (skipped)${NC}"; SKIPPED=$((SKIPPED + 1)); }
info() { echo -e "${CYAN}  → $*${NC}"; }

echo -e "\n${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  FibreFlow Local CI — Zero Tolerance                      ║${NC}"
echo -e "${BOLD}║  Mode: ${CYAN}${MODE}${NC}${BOLD}                                                ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"

# ─── Gate 0: Baseline consistency ────────────────────────────────────────────
# Runs before the gates it protects: every ratchet below is only as trustworthy
# as the number it compares against, and those numbers used to be copied into
# five files that disagreed. Cheap and dependency-free, so it runs in every mode.
echo -e "\n${CYAN}── Gate 0: CI baseline consistency ──${NC}\n"

if BASELINE_OUT=$(node scripts/check-ci-baselines.mjs 2>&1); then
  pass "CI baselines: consistent across all declaration sites"
else
  fail "CI baselines: drift detected — a gate is comparing against the wrong number"
  echo "$BASELINE_OUT" | sed 's/^/    /'
fi

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

# ─── Gate 1b: ESLint on pages/ (warnings + errors ratchet) ──────────────────
# `npm run lint` is `eslint src`, so until 2026-08-09 nothing linted pages/ —
# 1,623 files, including every API route: auth, RBAC, every DB call. Scored
# separately from src rather than as one combined number so that paying down
# pages debt cannot buy headroom for src regressions, and vice versa.
echo -e "\n${CYAN}── Gate 1b: ESLint (pages/) ──${NC}\n"

PAGES_LINT_OUTPUT=$(npm run lint:pages 2>&1 || true)
PAGES_LINT_SUMMARY=$(echo "$PAGES_LINT_OUTPUT" | grep -P '\d+ problems? \(' || echo "0 problems (0 errors, 0 warnings)")
PAGES_LINT_ERRORS=$(echo "$PAGES_LINT_SUMMARY" | grep -oP '\d+ error' | grep -oP '\d+' || echo "0")
PAGES_LINT_WARNINGS=$(echo "$PAGES_LINT_SUMMARY" | grep -oP '\d+ warning' | grep -oP '\d+' || echo "0")

if [ "$PAGES_LINT_WARNINGS" -le "$MAX_PAGES_LINT_WARNINGS" ] && [ "$PAGES_LINT_ERRORS" -le "$MAX_PAGES_LINT_ERRORS" ]; then
  pass "ESLint (pages): ${PAGES_LINT_ERRORS} errors (≤${MAX_PAGES_LINT_ERRORS}), ${PAGES_LINT_WARNINGS} warnings (≤${MAX_PAGES_LINT_WARNINGS})"
else
  fail "ESLint (pages): ${PAGES_LINT_ERRORS} errors (max ${MAX_PAGES_LINT_ERRORS}), ${PAGES_LINT_WARNINGS} warnings (max ${MAX_PAGES_LINT_WARNINGS})"
  if [ "$PAGES_LINT_ERRORS" -gt "$MAX_PAGES_LINT_ERRORS" ]; then
    info "New lint errors introduced under pages/! Fix before proceeding."
    echo "$PAGES_LINT_OUTPUT" | grep "  error  " | tail -10 | sed 's/^/    /'
  fi
  if [ "$PAGES_LINT_WARNINGS" -gt "$MAX_PAGES_LINT_WARNINGS" ]; then
    info "New lint warnings introduced under pages/! Fix or update baseline."
  fi
fi

# ─── Gate 2: Silent catches (API routes) ─────────────────────────────────────
echo -e "\n${CYAN}── Gate 2: Error Handling (no-silent-catch) ──${NC}\n"

CATCH_RC=0
CATCH_OUTPUT=$(npx eslint pages/api --ext .ts --rulesdir scripts/eslint-rules --rule '{"no-silent-catch": "warn"}' 2>&1) || CATCH_RC=$?
# `grep -c` exits 1 when it finds 0 matches, which combined with `pipefail`
# and a `|| echo "0"` fallback produced a "0\n0" multi-line count that broke
# the `[ -le ]` numeric comparison. Count with grep + wc + tr, with `|| true`
# so no-matches doesn't trip pipefail.
CATCH_COUNT=$( { echo "$CATCH_OUTPUT" | grep "no-silent-catch" || true; } | wc -l | tr -d ' ')

# ESLint exits 2 when it fails BEFORE linting anything — a bad --rulesdir, a
# target path that no longer exists, a broken config. Its output then contains
# no rule messages, so CATCH_COUNT is 0 and the gate would report a clean pass
# having scanned nothing. The old `|| true` swallowed exactly that.
if [ "$CATCH_RC" -ge 2 ]; then
  fail "Silent catches: eslint failed to run (exit ${CATCH_RC}) — gate scanned nothing"
  echo "$CATCH_OUTPUT" | tail -5 | sed 's/^/    /'
elif [ "$CATCH_COUNT" -le "$MAX_SILENT_CATCHES" ]; then
  pass "Silent catches: ${CATCH_COUNT} (≤${MAX_SILENT_CATCHES})"
else
  fail "Silent catches: ${CATCH_COUNT} (max ${MAX_SILENT_CATCHES}) — new silent catch blocks added"
  echo "$CATCH_OUTPUT" | grep "no-silent-catch" | tail -5 | sed 's/^/    /'
fi

# ─── Gate 2c: Neon-shim SQL divergence (must be 0) ───────────────────────────
# Bans the two patterns that break the pg.Pool-backed sql clients (neon-shim and
# @/lib/db-pool): (1) fragment-in-fragment interpolation `sql`...${sql`...`}...``,
# and (2) `sql.unsafe(text, params)` used as a query executor. Both are runtime
# bugs, not style — so this gate is hard-zero, not ratcheted. Run via --rulesdir
# (same mechanism as Gate 2) so it reaches pages/ which `npm run lint` skips.
# See docs/plans/2026-05-30-neon-shim-elimination-plan.md.
echo -e "\n${CYAN}── Gate 2c: Neon-shim SQL divergence (no-neon-shim-sql-divergence) ──${NC}\n"

DIVERGENCE_RC=0
DIVERGENCE_OUTPUT=$(npx eslint pages/api src lib --ext .ts,.tsx,.js --rulesdir scripts/eslint-rules --rule '{"no-neon-shim-sql-divergence": "error"}' 2>&1) || DIVERGENCE_RC=$?
DIVERGENCE_COUNT=$( { echo "$DIVERGENCE_OUTPUT" | grep "no-neon-shim-sql-divergence" || true; } | wc -l | tr -d ' ')

# See Gate 2: exit >= 2 means eslint never linted, so a zero count is
# indistinguishable from a clean scan.
if [ "$DIVERGENCE_RC" -ge 2 ]; then
  fail "Neon-shim SQL divergence: eslint failed to run (exit ${DIVERGENCE_RC}) — gate scanned nothing"
  echo "$DIVERGENCE_OUTPUT" | tail -5 | sed 's/^/    /'
elif [ "$DIVERGENCE_COUNT" -eq 0 ]; then
  pass "Neon-shim SQL divergence: none"
else
  fail "Neon-shim SQL divergence: ${DIVERGENCE_COUNT} (must be 0) — fragment interpolation or sql.unsafe() executor"
  echo "$DIVERGENCE_OUTPUT" | grep -B1 "no-neon-shim-sql-divergence" | tail -20 | sed 's/^/    /'
fi

# ─── Gate 2d: QField step-detection (pure-logic regression) ──────────────────
# Guards the GPKG photo-column → checklist-step mapping (qfield_step_detection.py)
# that feeds Works-QA ingestion — a silent regression here drops field photos from
# the dashboard. Pure/dependency-free (no DB) so it runs in every mode.
echo -e "\n${CYAN}── Gate 2d: QField step detection ──${NC}\n"

if command -v python3 >/dev/null 2>&1; then
  if python3 scripts/test_extract_gpkg_step_detection.py > /tmp/ci-qfield-stepdetect.txt 2>&1; then
    pass "QField step detection: all checks pass"
  else
    fail "QField step detection: regression detected"
    tail -20 /tmp/ci-qfield-stepdetect.txt | sed 's/^/    /'
  fi

  # Same contract, one layer up: which GPKG (and which layer inside it) the extractor
  # reads. Over-matching here silently swaps a project onto the wrong audit form, so
  # the suite asserts a no-op against every registered project's real MinIO listing.
  if python3 scripts/test_qfield_gpkg_resolution.py > /tmp/ci-qfield-gpkgresolve.txt 2>&1; then
    pass "QField GPKG resolution: all checks pass"
  else
    fail "QField GPKG resolution: regression detected"
    tail -20 /tmp/ci-qfield-gpkgresolve.txt | sed 's/^/    /'
  fi

  # Which old pole is which new pole after a replan, and — the part that actually
  # costs data — which poles may be deleted. Every rule here was a measured loss
  # (36 planted statuses, 70 audits, 15 more) before it existed.
  if python3 scripts/test_replan_match.py > /tmp/ci-replan-match.txt 2>&1; then
    pass "Replan pole matching: all checks pass"
  else
    fail "Replan pole matching: regression detected"
    tail -20 /tmp/ci-replan-match.txt | sed 's/^/    /'
  fi

  # The write path: do_import/do_rollback against a throwaway Postgres. Separate from
  # the matching tests above because it needs docker; skipping it silently would leave
  # the two functions that actually delete production data untested.
  if python3 scripts/test_replan_import_db.py > /tmp/ci-replan-import-db.txt 2>&1; then
    pass "Replan import write path: all checks pass"
  else
    fail "Replan import write path: regression detected"
    tail -25 /tmp/ci-replan-import-db.txt | sed 's/^/    /'
  fi

  # The guards that decide whether the write is allowed at all. Separate from the
  # write path above because a guard that computes the right answer and never acts
  # on it fails differently from a broken write.
  if python3 scripts/test_replan_guards.py > /tmp/ci-replan-guards.txt 2>&1; then
    pass "Replan pre-write guards: all checks pass"
  else
    fail "Replan pre-write guards: regression detected"
    tail -25 /tmp/ci-replan-guards.txt | sed 's/^/    /'
  fi

  # Backfill-only contract for qfield_hierarchy_sync: the GPKG fills NULLs and never
  # overwrites a value the PLAN owns. Reversing the COALESCE order silently reverted
  # 98 replanned poles on 2026-08-06, so this executes the real SQL rather than
  # inspecting it. Needs docker.
  if python3 scripts/test_qfield_hierarchy_backfill.py > /tmp/ci-hierarchy-backfill.txt 2>&1; then
    pass "QField hierarchy backfill-only: all checks pass"
  else
    fail "QField hierarchy backfill-only: regression detected"
    tail -25 /tmp/ci-hierarchy-backfill.txt | sed 's/^/    /'
  fi

  # The other half of the same writers: WHICH rows get touched, and what survives when
  # neither the plan nor the GPKG has a value. Both were unprotected — dropping a
  # project predicate or the third COALESCE argument left the backfill suite green.
  if python3 scripts/test_qfield_hierarchy_scoping.py > /tmp/ci-hierarchy-scoping.txt 2>&1; then
    pass "QField hierarchy scoping + fallback: all checks pass"
  else
    fail "QField hierarchy scoping + fallback: regression detected"
    tail -25 /tmp/ci-hierarchy-scoping.txt | sed 's/^/    /'
  fi

  # The guard that makes a stale GPKG column name fail LOUDLY. SQLite reads an
  # unresolvable "identifier" as a string literal instead of raising, which is how one
  # stale config froze a project's mirror for three days with no error. Pure sqlite,
  # no docker.
  if python3 scripts/test_qfield_gpkg_columns.py > /tmp/ci-gpkg-columns.txt 2>&1; then
    pass "QField GPKG column guard: all checks pass"
  else
    fail "QField GPKG column guard: regression detected"
    tail -25 /tmp/ci-gpkg-columns.txt | sed 's/^/    /'
  fi

  if python3 scripts/test_qfield_hierarchy.py > /tmp/ci-qfield-hierarchy.txt 2>&1; then
    pass "QField hierarchy mapping: all checks pass"
  else
    fail "QField hierarchy mapping: regression detected"
    tail -20 /tmp/ci-qfield-hierarchy.txt | sed 's/^/    /'
  fi

  if python3 scripts/test_qfield_project_registry.py > /tmp/ci-qfield-registry.txt 2>&1; then
    pass "QField project registry: all entries well-formed"
  else
    fail "QField project registry: malformed entry"
    grep '^  FAIL' /tmp/ci-qfield-registry.txt | head -20 | sed 's/^/    /'
  fi

  if python3 scripts/test_qfield_extract_characterization.py > /tmp/ci-qfield-extract.txt 2>&1; then
    pass "QField extract_project: behaviour unchanged"
  else
    fail "QField extract_project: observable behaviour changed"
    grep '^  FAIL' /tmp/ci-qfield-extract.txt | head -20 | sed 's/^/    /'
  fi

  if python3 scripts/test_qfield_extract_linked_projects.py > /tmp/ci-qfield-linked.txt 2>&1; then
    pass "QField linked-project paths: behaviour unchanged"
  else
    fail "QField linked-project paths: observable behaviour changed"
    grep '^  FAIL' /tmp/ci-qfield-linked.txt | head -20 | sed 's/^/    /'
  fi

  if python3 scripts/test_qfield_extract_run_decisions.py > /tmp/ci-qfield-rundec.txt 2>&1; then
    pass "QField run decisions (delta/spatial-PON): behaviour unchanged"
  else
    fail "QField run decisions (delta/spatial-PON): observable behaviour changed"
    grep '^  FAIL' /tmp/ci-qfield-rundec.txt | head -20 | sed 's/^/    /'
  fi
else
  skip "QField step detection: python3 not available"
  skip "QField GPKG resolution: python3 not available"
  skip "QField hierarchy mapping: python3 not available"
  skip "QField project registry: python3 not available"
  skip "QField extract_project characterization: python3 not available"
  skip "QField linked-project characterization: python3 not available"
  skip "QField run-decision characterization: python3 not available"
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

# ─── Gate 4: Zero Tolerance (changed files) ──────────────────────────────────
# The detection now lives in scripts/zero-tolerance-changed.sh so the GitHub
# Actions gate runs the SAME code. It used to be inline here and nowhere else,
# which is why rule 12 was enforced only when a human typed `npm run ci:quick`.
#
# --worktree keeps this gate's original semantics (uncommitted vs HEAD). Note
# what that means: once you commit, the set is empty and this gate passes on
# nothing. The CI side scans an explicit commit range for exactly that reason.
echo -e "\n${CYAN}── Gate 4: Zero Tolerance (changed files) ──${NC}\n"

if ZT_OUT=$(bash scripts/zero-tolerance-changed.sh --worktree 2>&1); then
  pass "Zero Tolerance: changed files clean"
else
  fail "Zero Tolerance: violation(s) in changed files"
  echo "$ZT_OUT" | sed 's/^/    /' | head -25
fi


# ─── Serial Lifecycle Discipline (Sprint E Track 3) ──────────────────────────
#
# Enforcement at cutover is the ESLint rule `local/no-direct-serial-status-write`
# (scripts/eslint-rules/), not a CI grep. To activate, the Sprint-E cutover PR
# flips it "off" → "error" in .eslintrc.json; Gate 1 above runs ESLint with
# MAX_LINT_ERRORS=0, so any direct `UPDATE stock_serials SET status/holder_id`
# outside the allow-list (serialLifecycle / serialForceCorrectService /
# backfill-serial-lifecycle-status) becomes a hard CI failure.
#
# A separate `git grep` gate was deliberately NOT added: every real writer
# spans two lines (`UPDATE stock_serials\n  SET status = ...`), which `git grep`
# (line-oriented, no multiline mode) cannot match, and a portable multiline
# `grep -Pz` cannot be relied on across dev/CI shells (e.g. ugrep treats -z as
# decompress). The AST-based ESLint rule matches these correctly; duplicating
# it in fragile shell would be false safety. Until cutover the rule stays "off"
# because Track 2's legitimate pre-cutover direct writers (import-serials,
# fault-reports, movementReversalService, the dead markSerialInstalled,
# grn-confirm) still write directly by design.

# ─── Gate 5+6: Tests & Build (full mode only) ────────────────────────────────
if [ "$MODE" = "--quick" ] || [ "$MODE" = "--pre-deploy" ]; then
  echo -e "\n${YELLOW}Skipped: tests + build (${MODE} mode)${NC}"
  SKIPPED=$((SKIPPED + 2))
else
  echo -e "\n${CYAN}── Gate 5: Unit Tests (ratchet) ──${NC}\n"

  # Ratcheted rather than non-blocking, matching GHA. Previously any failure
  # was downgraded to a warning here, so a new broken test slipped through both
  # this gate and CI. Known failures live in scripts/known-test-failures.txt;
  # a run that does not complete fails rather than passing silently.
  # Full suite locally (unlike the PR job, which only runs affected tests) —
  # this is the last gate before a deploy, so it should see everything.
  if bash "$(dirname "$0")/test-ratchet.sh" > /tmp/ci-tests.txt 2>&1; then
    pass "Unit tests: no new failures"
    grep -E 'now pass — delete them' /tmp/ci-tests.txt | head -1 | sed 's/^/    /' || true
  else
    fail "Unit tests: NEW failure(s), or the run did not complete"
    # `|| true` is load-bearing under `set -euo pipefail` (line 18): if the
    # ratchet fails in a way that emits none of these markers — missing execute
    # bit, syntax error, script not found — grep matches nothing and exits 1,
    # which would kill ci-local.sh here and silently skip the Build and Secret
    # Scan gates plus the final summary. Same bug this file already had to fix
    # twice (see the CATCH_COUNT and EMPTY_CATCH notes above).
    grep -E 'NEW test failure|no summary line|^    [a-z]' /tmp/ci-tests.txt | head -12 | sed 's/^/    /' || true
  fi

  echo -e "\n${CYAN}── Gate 6: Build ──${NC}\n"

  if npm run build > /tmp/ci-build.txt 2>&1; then
    pass "Build: success"
  else
    fail "Build: FAILED"
    tail -15 /tmp/ci-build.txt | sed 's/^/    /'
  fi
fi

# ─── Gate 7: Secret scan (newly-added credentials) ───────────────────────────
echo -e "\n${CYAN}── Gate 7: Secret Scan ──${NC}\n"

# The scanner's own tests run here as well as in ci.yml. Local and CI must agree
# on this gate: it is the one whose failure mode is silent, so a green ci:quick
# that does not exercise the scanner would be a false all-clear.
if SCANNER_TEST_OUT=$(node --test scripts/secret-scan.test.mjs 2>&1); then
  pass "Secret scan: scanner tests pass"
else
  fail "Secret scan: scanner tests FAILED — the scan itself is not trustworthy"
  echo "$SCANNER_TEST_OUT" | grep -E '^not ok|error:' | head -10 | sed 's/^/    /'
fi

if SECRET_OUT=$(bash scripts/secret-scan.sh --branch 2>&1); then
  pass "Secret scan: no new credential-like content"
else
  fail "Secret scan: credential-like content detected"
  echo "$SECRET_OUT" | sed 's/^/    /'
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
