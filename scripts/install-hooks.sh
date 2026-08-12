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
GIT_MAJOR=$(git version | sed -E 's/^git version ([0-9]+)\.([0-9]+).*/\1/')
GIT_MINOR=$(git version | sed -E 's/^git version ([0-9]+)\.([0-9]+).*/\2/')
if [ "$GIT_MAJOR" -lt 2 ] || { [ "$GIT_MAJOR" -eq 2 ] && [ "$GIT_MINOR" -lt 9 ]; }; then
  echo -e "${RED}🚫 core.hooksPath needs git >= 2.9; this is $(git version).${NC}" >&2
  exit 1
fi

echo "📎 Pointing git at $HOOKS_PATH ..."

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
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null || echo "")
if [ -n "$COMMON_DIR" ]; then
  STALE=$(ls "$COMMON_DIR/hooks"/{pre-commit,pre-push} 2>/dev/null | grep -v '\.sample$' || true)
  if [ -n "$STALE" ]; then
    echo ""
    echo -e "${YELLOW}Note: files remain in $COMMON_DIR/hooks:${NC}"
    echo "$STALE" | sed 's/^/  /'
    echo -e "${YELLOW}They are no longer used — core.hooksPath takes precedence. Left in${NC}"
    echo -e "${YELLOW}place deliberately: one may be the only copy of a local guard. Check${NC}"
    echo -e "${YELLOW}them for anything worth porting into $HOOKS_PATH, then delete.${NC}"
  fi
fi

echo ""
echo "pre-commit runs on commit; pre-push runs on push."
echo "To bypass (emergency only — never for real secrets): --no-verify"
