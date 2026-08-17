#!/bin/bash
# =============================================================================
# Point git at this repo's tracked hooks
# =============================================================================
# Usage: bash scripts/install-hooks.sh
#
# Sets `core.hooksPath` to an ABSOLUTE path at the main worktree's
# scripts/githooks, where the hooks are tracked files. Git runs them in place;
# nothing is copied. Absolute because the config is one value for the whole
# repository while a relative path resolves per checkout -- see the note below.
# Requires git >= 2.9. Verified on 2.43 from both the main checkout and a worktree.
#
# WHY it is absolute, WHY nothing is copied, and the residual failure mode this
# design accepts -- a working-tree anchor means the gate is only as present as
# that directory, and git does not warn when it is gone:
#
#   .claude/modules/git-hooks.md
#
# Read that before changing anything here. The guards below look over-built; each
# one is a defect that was measured, and the module doc says which.
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

# Resolve the worktree to anchor to: the first listed one that is a real working
# tree. Absolute, because ONE config value is shared by every checkout while a
# relative path resolves per checkout -- which silently disabled the hooks in 42
# of 43 worktrees here.
#
# Split on the "worktree " prefix, NOT on whitespace: `awk '{print $2}'` truncated
# any repo path containing a SPACE. And require each candidate to be the ROOT of a
# real working tree -- the first porcelain entry is a bare git-dir for a bare repo
# and .git/modules/<name> inside a submodule, neither of which ever has the hooks.
# Both measured; see .claude/modules/git-hooks.md.
WT_LIST=$(git worktree list --porcelain 2>/dev/null || echo '')
MAIN_WORKTREE=""
while IFS= read -r line; do
  [ "${line#worktree }" = "$line" ] && continue
  cand=${line#worktree }
  [ -n "$cand" ] && [ -d "$cand" ] || continue
  cand_top=$(git -C "$cand" rev-parse --show-toplevel 2>/dev/null || echo '')
  if [ -n "$cand_top" ] && [ "$cand_top" = "$cand" ]; then
    MAIN_WORKTREE=$cand
    break
  fi
done <<EOF
$WT_LIST
EOF

if [ -z "$MAIN_WORKTREE" ]; then
  # No usable entry (very old git without `worktree list`, or a layout where no
  # listed entry is a working tree). Fall back to this checkout, which is a real
  # working tree by definition -- we already refused when not in a repo.
  MAIN_WORKTREE=$(git rev-parse --show-toplevel 2>/dev/null || echo '')
fi

if [ -z "$MAIN_WORKTREE" ]; then
  echo -e "${RED}🚫 Could not resolve a working tree to anchor the hooks to.${NC}" >&2
  echo    "   core.hooksPath must be an absolute path to a real directory." >&2
  exit 1
fi

HOOKS_ABS="$MAIN_WORKTREE/$HOOKS_PATH"

# Verify the TARGET, not the current checkout. Setting a path that does not
# exist is strictly worse than the relative form it replaces — it would disable
# the hooks everywhere instead of only in stale worktrees. Fail closed and say
# exactly how to fix it.
if [ ! -d "$HOOKS_ABS" ]; then
  echo -e "${RED}🚫 $HOOKS_ABS does not exist.${NC}" >&2
  echo    "   core.hooksPath is one value for the whole repository, so it must" >&2
  echo    "   point at a directory that is really there. The anchor worktree" >&2
  echo    "   ($MAIN_WORKTREE) appears to be on a commit predating these hooks." >&2
  echo    "" >&2
  echo    "   Bring it up to date, then re-run:" >&2
  echo    "     git -C '$MAIN_WORKTREE' checkout master && git -C '$MAIN_WORKTREE' pull" >&2
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

echo "📎 Pointing git at $HOOKS_ABS ..."

# A hook that is not executable is SKIPPED BY GIT SILENTLY, so check rather than
# assume. The bit is tracked (mode 100755), but a clone with a restrictive umask
# or a filesystem without the exec bit will not have it.
#
# This runs BEFORE the config is written, and that ordering is the point. It used
# to run after: the script printed the green "core.hooksPath = ..." banner, then
# the red "not executable" line, exited 1 -- and LEFT THE CONFIG SET to a
# directory whose hooks git would skip. An empty directory did the same. A
# reported failure that still mutates config is the exact shape of bug this file
# exists to prevent, so validate first and only then write.
MISSING_EXEC=""
for h in pre-commit pre-push; do
  if [ ! -x "$HOOKS_ABS/$h" ]; then
    MISSING_EXEC="$MISSING_EXEC $h"
  fi
done

if [ -n "$MISSING_EXEC" ]; then
  echo -e "${RED}🚫 not executable:$MISSING_EXEC${NC}" >&2
  echo    "   Git SKIPS a non-executable hook without saying so, so these would" >&2
  echo    "   never run. core.hooksPath was NOT changed." >&2
  echo    "   Fix with: chmod +x '$HOOKS_ABS'/*" >&2
  exit 1
fi

# Report what is being replaced. A pre-existing core.hooksPath is a higher-signal
# conflict than a leftover file in .git/hooks, and overwriting it silently is the
# same class of loss this design was chosen to avoid -- just in config rather
# than in a file. `--show-origin` names which file it came from, so a value
# inherited from ~/.gitconfig is distinguishable from a local one.
PRIOR=$(git config --get core.hooksPath 2>/dev/null || echo '')
if [ -n "$PRIOR" ] && [ "$PRIOR" != "$HOOKS_ABS" ]; then
  echo -e "${YELLOW}⚠️  core.hooksPath was already set, and is being replaced:${NC}"
  echo    "     was: $PRIOR"
  echo    "     now: $HOOKS_ABS"
  # `--show-origin` prints "<origin>\t<value>", so cut at the TAB. `awk '{print
  # $1}'` split on whitespace and truncated any config path containing a space.
  ORIGIN=$(git config --show-origin --get core.hooksPath 2>/dev/null | cut -f1 || echo '')
  [ -n "$ORIGIN" ] && echo "     previous value came from: $ORIGIN"
  echo -e "${YELLOW}   If those hooks are still wanted, they need to move into${NC}"
  echo -e "${YELLOW}   $HOOKS_ABS — git reads ONE hooks directory, not both.${NC}"
fi

if ! git config core.hooksPath "$HOOKS_ABS"; then
  echo -e "${RED}🚫 Could not set core.hooksPath.${NC}" >&2
  exit 1
fi

# Read the value back. `git config` can succeed against a config this repo does
# not actually use -- confirm the effective value is the one intended.
EFFECTIVE=$(git config --get core.hooksPath || echo '<unset>')
if [ "$EFFECTIVE" != "$HOOKS_ABS" ]; then
  echo -e "${RED}🚫 core.hooksPath reads back as '$EFFECTIVE', not '$HOOKS_ABS'.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}✅ core.hooksPath = $HOOKS_ABS${NC}"
echo "   pre-commit: secret scanner"
echo "   pre-push:   master protection + secret scan + auth isolation"
echo ""
echo "   This is one value for the whole repository, and it is only as present as"
echo "   that directory. If that checkout moves off a branch carrying the hooks,"
echo "   git silently runs none of them anywhere. CI still scans pushed commits."

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
    echo -e "${YELLOW}git now reads ONLY $HOOKS_ABS, so none of them run.${NC}"
    if [ -n "$OTHERS" ]; then
      echo -e "${RED}   Including hook(s) this repo does NOT ship:${NC}"
      printf '%s\n' "$OTHERS" | sed 's/^/     /'
      echo -e "${RED}   Those were yours. They have stopped firing. To keep them, move${NC}"
      echo -e "${RED}   them into $HOOKS_ABS — git reads one directory, not both.${NC}"
    fi
    echo -e "${YELLOW}   Nothing was deleted; one may be the only copy of a local guard.${NC}"
  fi
fi

echo ""
echo "pre-commit runs on commit; pre-push runs on push."
echo "To bypass (emergency only — never for real secrets): --no-verify"
