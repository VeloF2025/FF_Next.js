#!/bin/bash
# =============================================================================
# Point git at this repo's tracked hooks
# =============================================================================
# Usage: bash scripts/install-hooks.sh
#
# Sets `core.hooksPath` to scripts/githooks, where the hooks are tracked files.
# Git then runs them in place. Nothing is copied.
# =============================================================================
# This used to COPY the hook scripts into .git/hooks. That design was the source
# of the bug it was eventually rewritten to prevent: on one workstation the
# installed pre-push had diverged from the tracked script and carried a
# master-push guard the tracked one lacked, so installing would have added the
# secret scan and deleted that guard in the same command, silently (#2438).
#
# Hardening the copy took three review rounds and fourteen findings -- backup on
# divergence, collision-safe backup names, symlink replacement, an unguarded
# chmod that let git skip a non-executable hook while the script reported
# success, repo-shape resolution, refusal paths. Each was a real Unix edge case
# around copying a file into a directory git owns. The list was not converging.
#
# core.hooksPath removes the class rather than guarding it:
#
#   nothing is copied      -> nothing can be clobbered, so no backups are needed
#   nothing is written to  -> no permission, ownership or chmod failure path
#     .git/hooks
#   hooks are tracked      -> version-controlled, code-reviewed, and identical
#                             on every clone by construction
#
# Verified on git 2.43: the hooks run from the main checkout AND from a worktree,
# because the config is shared. Requires git >= 2.9.
#
# What this does NOT change: it is still one command per clone, `--no-verify`
# still bypasses, and someone can still unset the config. That last one is a
# deliberate act with a visible cause, not a silent overwrite -- which is the
# whole difference.
# =============================================================================

set -uo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

HOOKS_PATH="scripts/githooks"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo -e "${RED}🚫 Not inside a git repository.${NC}" >&2
  exit 1
fi

REPO_ROOT=$(git rev-parse --show-toplevel)
if [ ! -d "$REPO_ROOT/$HOOKS_PATH" ]; then
  echo -e "${RED}🚫 $HOOKS_PATH does not exist in this checkout.${NC}" >&2
  echo    "   Expected the tracked hooks to live there." >&2
  exit 1
fi

# git >= 2.9. Refuse rather than set a key the local git will ignore, which
# would leave the hooks silently unused while this reported success.
#
# The parse must FAIL CLOSED, and getting that wrong is how this gate became the
# very thing it guards against. `sed` echoes its input unchanged when the pattern
# does not match, so an unparseable `git version` left non-numeric values here;
# `[ "$x" -lt 2 ]` then errors instead of returning true or false, `set -e` does
# not apply inside an `if` condition, both sides of the `||` errored, the whole
# condition evaluated false, and the script fell through to print a green banner.
# Measured with a shimmed `git`: exit 0, config set, two swallowed "integer
# expression expected" lines. Reachable via a wrapped git — corporate security
# tooling, a version manager.
#
# So: extract with a pattern that can only yield digits, and require BOTH parts
# to be non-empty digit strings before comparing anything.
GIT_VERSION_RAW=$(git version 2>/dev/null || echo '')
GIT_MAJOR=$(printf '%s' "$GIT_VERSION_RAW" | sed -nE 's/^git version ([0-9]+)\.([0-9]+).*/\1/p')
GIT_MINOR=$(printf '%s' "$GIT_VERSION_RAW" | sed -nE 's/^git version ([0-9]+)\.([0-9]+).*/\2/p')
git_version_unusable() {
  # Digits only, and SHORT enough for `[ -lt ]` to compare.
  #
  # A digits-only check was not sufficient: an all-digit but huge value makes
  # `[ "$x" -lt 2 ]` fail with "integer expression expected" -- the same error
  # shape, down the same unguarded path, with the same fail-open outcome as a
  # non-numeric value. Measured with a 32-digit major: exit 0, config set, green
  # banner. My own probe of this vector used 13 digits, which fits in an int64
  # and compared fine, so it reported the hole as closed.
  #
  # 5 digits is the bound. git's major and minor have never exceeded two, and a
  # five-digit component is not a version -- it is garbage that happens to be
  # numeric. Bounding the INPUT is what makes the comparison below safe to run,
  # rather than trying to predict which values the shell can handle.
  case "$1:$2" in
    *[!0-9:]* | :* | *: | '') return 0 ;;
  esac
  [ "${#1}" -gt 5 ] && return 0
  [ "${#2}" -gt 5 ] && return 0
  return 1
}

if git_version_unusable "$GIT_MAJOR" "$GIT_MINOR"; then
  echo -e "${RED}🚫 Could not read a usable git version from: '${GIT_VERSION_RAW}'${NC}" >&2
  echo    "   core.hooksPath needs git >= 2.9 and is IGNORED by older versions," >&2
  echo    "   so refusing rather than setting a key that may never be read." >&2
  exit 1
fi

if [ "$GIT_MAJOR" -lt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -lt 9 ]; }; then
  echo -e "${RED}🚫 core.hooksPath needs git >= 2.9; this is ${GIT_VERSION_RAW}.${NC}" >&2
  exit 1
fi

echo "📎 Pointing git at $HOOKS_PATH ..."

# Report what is being replaced. A pre-existing core.hooksPath is a higher-signal
# conflict than a leftover file in .git/hooks, and overwriting it silently is the
# same class of loss this design was chosen to avoid -- just in config rather
# than in a file. `--show-origin` names which file it came from, so a value
# inherited from ~/.gitconfig is distinguishable from a local one.
PRIOR=$(git config --get core.hooksPath 2>/dev/null || echo '')
if [ -n "$PRIOR" ] && [ "$PRIOR" != "$HOOKS_PATH" ]; then
  echo -e "${YELLOW}⚠️  core.hooksPath was already set, and is being replaced:${NC}"
  echo    "     was: $PRIOR"
  echo    "     now: $HOOKS_PATH"
  # `--show-origin` prints "<origin>\t<value>", so cut at the TAB. `awk '{print
  # $1}'` split on whitespace and truncated any config path containing a space.
  ORIGIN=$(git config --show-origin --get core.hooksPath 2>/dev/null | cut -f1 || echo '')
  [ -n "$ORIGIN" ] && echo "     previous value came from: $ORIGIN"
  echo -e "${YELLOW}   If those hooks are still wanted, they need to move into${NC}"
  echo -e "${YELLOW}   $HOOKS_PATH — git reads ONE hooks directory, not both.${NC}"
fi

if ! git config core.hooksPath "$HOOKS_PATH"; then
  echo -e "${RED}🚫 Could not set core.hooksPath.${NC}" >&2
  exit 1
fi

# A hook that is not executable is SKIPPED BY GIT SILENTLY, so check rather than
# assume. The bit is tracked (mode 100755), but a clone with a restrictive umask
# or a filesystem without the exec bit will not have it.
MISSING_EXEC=""
for h in pre-commit pre-push; do
  if [ ! -x "$REPO_ROOT/$HOOKS_PATH/$h" ]; then
    MISSING_EXEC="$MISSING_EXEC $h"
  fi
done

# Read the value back. `git config` can succeed against a config this repo does
# not actually use -- confirm the effective value is the one intended.
EFFECTIVE=$(git config --get core.hooksPath || echo '<unset>')
if [ "$EFFECTIVE" != "$HOOKS_PATH" ]; then
  echo -e "${RED}🚫 core.hooksPath reads back as '$EFFECTIVE', not '$HOOKS_PATH'.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}✅ core.hooksPath = $HOOKS_PATH${NC}"
echo "   pre-commit: secret scanner"
echo "   pre-push:   master protection + secret scan + auth isolation"

if [ -n "$MISSING_EXEC" ]; then
  echo ""
  echo -e "${RED}🚫 not executable:$MISSING_EXEC${NC}" >&2
  echo    "   Git SKIPS a non-executable hook without saying so, so these would" >&2
  echo    "   never run. Fix with: chmod +x $HOOKS_PATH/*" >&2
  exit 1
fi

# Anything previously copied into .git/hooks still takes no effect now, but it is
# left in place rather than deleted: it may be the only copy of a local guard.
# Report EVERY hook left in .git/hooks, not just the two this repo ships.
#
# core.hooksPath redirects git for ALL hook types, so a developer's own
# `commit-msg` or `post-checkout` stops firing the moment this runs -- measured,
# with a working commit-msg hook that stopped blocking. The earlier version of
# this notice only looked for pre-commit and pre-push, so exactly the hooks that
# are NOT ours -- the ones nobody else knows about -- went unmentioned.
#
# Nothing is deleted: one of these may be the only copy of something.
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || echo "")
if [ -n "$COMMON_DIR" ] && [ -d "$COMMON_DIR/hooks" ]; then
  # Executable, non-sample files only: a non-executable leftover was already
  # being ignored by git before this change, so it is not something being lost.
  STALE=$(find "$COMMON_DIR/hooks" -maxdepth 1 -type f -perm -u+x ! -name '*.sample' \
            -printf '%f\n' 2>/dev/null | sort || true)
  if [ -n "$STALE" ]; then
    OURS=$(printf 'pre-commit\npre-push\n')
    OTHERS=$(comm -23 <(printf '%s\n' "$STALE") <(printf '%s\n' "$OURS") || true)
    echo ""
    echo -e "${YELLOW}Note: executable hooks remain in $COMMON_DIR/hooks:${NC}"
    printf '%s\n' "$STALE" | sed 's/^/  /'
    echo -e "${YELLOW}git now reads ONLY $HOOKS_PATH, so none of them run.${NC}"
    if [ -n "$OTHERS" ]; then
      echo -e "${RED}   Including hook(s) this repo does NOT ship:${NC}"
      printf '%s\n' "$OTHERS" | sed 's/^/     /'
      echo -e "${RED}   Those were yours. They have stopped firing. To keep them, move${NC}"
      echo -e "${RED}   them into $HOOKS_PATH — git reads one directory, not both.${NC}"
    fi
    echo -e "${YELLOW}   Nothing was deleted; one may be the only copy of a local guard.${NC}"
  fi
fi

echo ""
echo "pre-commit runs on commit; pre-push runs on push."
echo "To bypass (emergency only — never for real secrets): --no-verify"
