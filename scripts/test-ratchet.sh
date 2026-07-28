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
# genuinely failing tests plus 10 files that fail to collect. Blocking on those
# would have stopped every merge in the repo. So this gates on IDENTITY instead:
# any FAIL not listed in scripts/known-test-failures.txt fails the build.
#
# Identity rather than a count, for two reasons:
#   - a count lets a PR swap one failure for another and stay green;
#   - a count is meaningless on a partial run, and the PR job deliberately runs
#     only the tests affected by its diff.
#
# Usage:
#   bash scripts/test-ratchet.sh                        # whole suite
#   bash scripts/test-ratchet.sh --changed origin/master # only affected tests
# Any arguments are passed straight through to vitest.
#
# Exit: 0 = no new failures, 1 = new failure (or the run did not complete).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALLOWLIST="$REPO_ROOT/scripts/known-test-failures.txt"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

WORK="$(mktemp -d "${TMPDIR:-/tmp}/vitest-ratchet-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
OUTPUT="$WORK/out.txt"

if [ ! -f "$ALLOWLIST" ]; then
  echo -e "${RED}✗ Missing allowlist: $ALLOWLIST${NC}"
  exit 1
fi

# Strip comments/blank lines to get the bare identifiers.
grep -vE '^\s*#|^\s*$' "$ALLOWLIST" | sort -u > "$WORK/allowed.txt"

run_suite() {
  echo "Running unit tests${*:+ ($*)}…"
  # A non-zero exit is expected whenever anything fails — that is the case being
  # measured, so it must not abort the script. Completeness is judged from the
  # summary line below, never from the exit code.
  #
  # Bounded by `timeout` so a future deadlock (this gate exists because of one)
  # fails loudly instead of hanging a local run forever. GHA has its own
  # timeout-minutes, but `bash scripts/ci-local.sh` has nothing else to stop it.
  # A kill produces no summary line, which the check below turns into a failure.
  local raw="$WORK/out.raw"
  if command -v timeout >/dev/null 2>&1; then
    NO_COLOR=1 FORCE_COLOR=0 timeout "${RATCHET_TIMEOUT_SECS:-900}" \
      npm test -- --run --reporter=basic "$@" > "$raw" 2>&1 || true
  else
    NO_COLOR=1 FORCE_COLOR=0 \
      npm test -- --run --reporter=basic "$@" > "$raw" 2>&1 || true
  fi

  # Strip ANSI escapes before anything is parsed.
  #
  # This is not cosmetic. vitest disables colour when stdout is a file, so
  # redirecting locally produced clean text and every check below matched. On
  # GitHub Actions it emits colour anyway, turning the summary into
  # "\e[2m      Tests \e[22m \e[1m\e[31m6 failed" — which matches neither the
  # summary regex nor the FAIL-line extraction. The first CI run of this gate
  # therefore reported a completed suite as "did not complete", and every known
  # failure would have parsed as a new one. Stripping here rather than trusting
  # NO_COLOR/FORCE_COLOR to be honoured: the env vars are set above as well, but
  # the parser must not depend on a tool's colour heuristics.
  #
  # The parameter class spans ECMA-48's CSI parameter range (0x30-0x3F), not just
  # digits and ';'. Two forms would otherwise fail to match at all and pass
  # through verbatim — `ESC[?25l` (cursor hide) and `ESC[38:2:r:g:bm` (truecolor,
  # which uses ':' separators) — landing inside an identifier and making a known
  # failure parse as new. --reporter=basic emits neither today, but a parser
  # guarding a merge gate should not depend on a reporter's escape repertoire.
  # A literal ESC byte is required to start a match, so test names containing
  # '[', '→' or other unicode can never be corrupted by this.
  sed -E "s|$(printf '\033')\[[0-9;:?<>=!]*[a-zA-Z]||g" "$raw" > "$OUTPUT"

  # A hung, killed or crashed run emits no summary. That MUST fail: treating a
  # missing summary as "no failures" is exactly how the old setup reported a
  # 5-minute timeout kill as success.
  if ! grep -qE '^ *Tests +[0-9]+|^ *No test files found' "$OUTPUT"; then
    echo -e "${RED}✗ Unit tests: no summary line — the run did not complete.${NC}"
    echo "  A hang, crash or timeout kill lands here. It is NOT treated as a pass."
    tail -25 "$OUTPUT" | sed 's/^/    /'
    return 1
  fi

  grep -E '^ *Tests +[0-9]+|^ *Test Files +[0-9]+' "$OUTPUT" | tail -2 | sed 's/^ */  /'
  # FAIL lines carry the identity of each failing test or uncollectable file.
  grep -E '^ *FAIL ' "$OUTPUT" | sed -E 's/^ *FAIL +//' | sort -u > "$WORK/actual.txt"
  comm -23 "$WORK/actual.txt" "$WORK/allowed.txt" > "$WORK/new.txt"
  return 0
}

# Flake guard. This runner is single-concurrency and shared with the production
# service, so a run competing with a `next build` can time tests out, and vitest
# has been observed segfaulting outright (once in ~8 runs) with swap near full.
# Either is noise, not a regression.
#
# The rule: PASS only if some attempt comes back both complete and clean. At
# most two attempts, and the retry happens only when we are otherwise about to
# fail, so the happy path costs one run.
#
# Deliberately not "fail on failures common to both runs". That intersection
# dismissed any item which first appeared on the second run without ever giving
# it a second observation, so two different one-off failures — one on each run —
# cancelled each other out and the gate reported clean. Requiring a clean run is
# symmetric and has no such gap: if the retry surfaces anything unlisted, same
# item or not, the run fails and reports the union.
: > "$WORK/confirmed.txt"
: > "$WORK/new-first.txt"

if run_suite "$@"; then
  first_completed=1
  cp "$WORK/new.txt" "$WORK/new-first.txt"
else
  first_completed=0
fi

if [ "$first_completed" -eq 0 ] || [ -s "$WORK/new-first.txt" ]; then
  if [ "$first_completed" -eq 0 ]; then
    echo -e "${YELLOW}  run did not complete — retrying once before failing…${NC}"
  else
    echo -e "${YELLOW}  $(wc -l < "$WORK/new-first.txt") unlisted failure(s) — re-running once; the retry must come back clean…${NC}"
  fi

  # A second incomplete run is not noise. Fail, and say so plainly rather than
  # letting a crash masquerade as "no new failures".
  run_suite "$@" || {
    echo -e "${RED}✗ Unit tests: the run did not complete on either attempt.${NC}"
    exit 1
  }

  if [ -s "$WORK/new.txt" ]; then
    sort -u "$WORK/new-first.txt" "$WORK/new.txt" > "$WORK/confirmed.txt"
  fi
fi

if [ -s "$WORK/confirmed.txt" ]; then
  echo -e "${RED}✗ NEW test failure(s) not in scripts/known-test-failures.txt:${NC}"
  sed 's/^/    /' "$WORK/confirmed.txt"
  echo ""
  echo "  Fix them. Do not append them to the allowlist to go green."
  exit 1
fi

# Report entries that no longer fail so the allowlist can be pruned. Only
# meaningful on a full run — a subset simply did not execute most of them.
if [ $# -eq 0 ]; then
  comm -13 "$WORK/actual.txt" "$WORK/allowed.txt" > "$WORK/fixed.txt" || true
  if [ -s "$WORK/fixed.txt" ]; then
    echo -e "${YELLOW}  $(wc -l < "$WORK/fixed.txt") allowlisted failure(s) now pass — delete them from scripts/known-test-failures.txt:${NC}"
    head -10 "$WORK/fixed.txt" | sed 's/^/    /'
  fi
fi

echo -e "${GREEN}✓ Unit tests: no new failures${NC}"
exit 0
