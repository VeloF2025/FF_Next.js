#!/bin/bash
# =============================================================================
# Zero Tolerance on changed files — CLAUDE.md rule 12
# =============================================================================
# Two checks over the .ts/.tsx files a change touches:
#   1. console.* calls          (use `log` from @/lib/logger)
#   2. empty catch blocks       (`catch (e) {}`)
#
# Changed-files-only by design. Rule 12 says "CHANGED code is zero-tolerance",
# and the repo carries pre-existing debt in both categories that is ratcheted
# elsewhere (Gate 1/1b lint warnings, Gate 2 silent catches). Gating the whole
# tree here would block every PR.
#
# Extracted from scripts/ci-local.sh Gate 4 so the GitHub Actions gate and the
# local gate run the SAME detection. The awk below encodes several already-paid-
# for bug fixes; a second copy of it in ci.yml would drift from this one.
#
# Usage:
#   bash scripts/zero-tolerance-changed.sh --worktree            # uncommitted vs HEAD
#   bash scripts/zero-tolerance-changed.sh --range <base> <head> # CI: a commit range
#
# Exit 0 = clean, 1 = violation(s) found, 2 = could not determine what to scan.
# =============================================================================

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

MODE="${1:---worktree}"

case "$MODE" in
  --worktree)
    # What ci-local.sh has always used. NOTE: this is the WORKING TREE diff, so
    # it sees nothing once changes are committed — running ci:quick after a
    # commit exercises this gate against an empty set. That is why the CI side
    # below uses an explicit range instead of reusing this mode.
    CHANGED=$(git diff --name-only HEAD 2>/dev/null || true)
    ;;
  --range)
    BASE="${2:-}"; HEAD_REF="${3:-}"
    if [ -z "$BASE" ] || [ -z "$HEAD_REF" ]; then
      echo -e "${RED}zero-tolerance: --range needs <base> <head>${NC}"; exit 2
    fi
    # Fail CLOSED on an unresolvable ref. `git diff` would otherwise print to
    # stderr, yield an empty file list, and report a clean gate over nothing —
    # the same fail-open shape that made the secret scan a no-op in CI.
    for ref in "$BASE" "$HEAD_REF"; do
      if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null 2>&1; then
        echo -e "${RED}zero-tolerance: cannot resolve '${ref}' — refusing to report a clean gate.${NC}"
        exit 2
      fi
    done
    # Three dots: changes introduced on HEAD since it diverged from BASE, so an
    # unrelated commit landing on master mid-review does not enter the scan.
    CHANGED=$(git diff --name-only "${BASE}...${HEAD_REF}" 2>/dev/null || true)
    ;;
  *)
    echo -e "${RED}zero-tolerance: unknown mode '$MODE'${NC}"; exit 2
    ;;
esac

if [ -z "$CHANGED" ]; then
  echo -e "${GREEN}✅ Zero Tolerance: no changed files to check.${NC}"
  exit 0
fi

# `[ -f "$f" ]` is false for a file the change DELETED. Without the trailing
# `|| true` the loop's last exit status is non-zero, pipefail propagates it out
# of $(), and the gate dies silently mid-run on a deletion-only PR.
CONSOLE_HITS=$(echo "$CHANGED" \
  | { grep -E '\.(ts|tsx)$' || true; } \
  | { grep -v '.test.' || true; } \
  | { grep -v '.spec.' || true; } \
  | while read -r f; do
      [ -f "$f" ] && awk -v file="$f" '
        {
          line = $0
          if (line ~ /console\.(log|error|warn|info|debug)/ \
              && line !~ /^[[:space:]]*\/\// \
              && line !~ /eslint-disable-line[[:space:]]+(no-console|.*,[[:space:]]*no-console)/ \
              && prev !~ /eslint-disable-next-line[[:space:]]+(no-console|.*,[[:space:]]*no-console)/) {
            print file ":" NR ":" line
          }
          prev = line
        }
      ' "$f" || true
    done)

# Deliberately NOT filtered to exclude tests, matching the original gate: an
# empty catch swallows a failure just as silently in a test as in production.
EMPTY_CATCH=$(echo "$CHANGED" \
  | { grep -E '\.(ts|tsx)$' || true; } \
  | while read -r f; do
      [ -f "$f" ] && grep -n 'catch.*{[[:space:]]*}' "$f" 2>/dev/null | sed "s|^|$f:|" || true
    done)

FAILED=0
if [ -n "$CONSOLE_HITS" ]; then
  echo -e "${RED}🚫 console.* in changed files — use \`log\` from @/lib/logger:${NC}"
  echo "$CONSOLE_HITS" | head -20 | sed 's/^/    /'
  FAILED=1
fi

if [ -n "$EMPTY_CATCH" ]; then
  echo -e "${RED}🚫 Empty catch blocks in changed files:${NC}"
  echo "$EMPTY_CATCH" | head -20 | sed 's/^/    /'
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "CLAUDE.md rule 12: changed code is zero-tolerance."
  exit 1
fi

echo -e "${GREEN}✅ Zero Tolerance: changed files clean.${NC}"
exit 0
