#!/bin/bash
# =============================================================================
# Pre-Push Hook: Master Protection + Secret Scan + Auth Isolation Guard
# =============================================================================
# GUARD 1: block non-interactive pushes straight to master/main.
# GUARD 2: secret scan over the pushed range (per-ref, below).
# GUARD 3: scan outgoing commits for hardcoded userId patterns that bypass auth.
#
# WHY GUARD 1 IS IN THIS FILE: it existed only in the *installed* hook at
# .git/hooks/pre-push on one workstation, never in this tracked script. The two
# had diverged, so `bash scripts/install-hooks.sh` would install the secret scan
# and simultaneously DELETE the master protection — one guard silently traded for
# another. Both live here now, so installing loses nothing.
#
# Measured 2026-08-11: the installed pre-push had zero references to
# secret-scan, and so did the installed pre-commit. CLAUDE.md rule 11 claims the
# scan runs at three points; CI became real in #2425, and this closes the two
# local ones.
#
# GUARD 3 details:
# Scans outgoing commits for hardcoded userId patterns that bypass auth.
#
# BLOCKS:
#   const userId = 'dev-user-1'   ← hardcoded dev user (auth bypass)
#   userId = req.body.userId       ← privilege escalation
#   const userId = 'admin'         ← hardcoded admin
#   const userId = 'system'        ← hardcoded system (as primary, not fallback)
#
# ALLOWS:
#   (req as any).user?.id          ← correct: auth middleware context
#   userId || 'system'             ← correct: fallback after auth check
#   req.user.id                    ← correct: auth middleware context
#
# CONTEXT:
#   Feb 21, 2026 — Auth isolation sweep found 11 endpoints using hardcoded
#   userId = 'dev-user-1'. This caused all users to share one data row.
#   This hook prevents regression.
#
# INSTALL:
#   bash scripts/install-hooks.sh
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Stdin is the ref list and can be read only ONCE, so capture it up front and
# feed both guards from the variable. Every loop below uses a here-string rather
# than a pipe: a piped `while` runs in a subshell, and VIOLATIONS_FOUND is
# incremented inside the loop and read after it, so a pipe would silently discard
# every violation and pass the push.
PUSH_REFS=$(cat)

# ─── GUARD 1: master/main protection ─────────────────────────────────────────
# Lifted from the installed hook with its behaviour preserved exactly, including
# the `[ -t 0 ]` branch. That branch is DEAD and was dead there too: git hands a
# pre-push hook its ref list on stdin, so stdin is never a terminal. It is kept
# rather than "fixed" because changing what this guard ALLOWS is a separate
# decision from making it survive install-hooks.sh. CLAUDECODE=1 is what
# actually lets an interactive Claude Code session through.
BLOCK_MASTER=0
while read -r _lref _lsha remote_ref _rsha; do
  [ -z "${remote_ref:-}" ] && continue
  case "$remote_ref" in
    refs/heads/master | refs/heads/main) ;;
    *) continue ;;
  esac
  [ "${ALLOW_MASTER_PUSH:-}" = "1" ] && continue
  [ -t 0 ] 2>/dev/null && continue
  [ "${CLAUDECODE:-}" = "1" ] && continue
  BLOCK_MASTER=1
done <<< "$PUSH_REFS"

if [ "$BLOCK_MASTER" = "1" ]; then
  AGENT_INFO=""
  [ -n "${OPENCLAW_AGENT:-}" ] && AGENT_INFO=" (OpenClaw: $OPENCLAW_AGENT)"
  [ -z "$AGENT_INFO" ] && AGENT_INFO=" ($(git config user.name 2>/dev/null || echo 'unknown'))"
  echo ""
  echo "🚫 BLOCKED: Direct push to master by non-interactive session${AGENT_INFO}"
  echo ""
  echo "   Options:"
  echo "     1. Use a feature branch + PR:"
  echo "        git checkout -b <name>/<description>"
  echo "        git push origin <name>/<description>"
  echo "        gh pr create --title '...' --body '...'"
  echo ""
  echo "     2. Override (humans only):"
  echo "        ALLOW_MASTER_PUSH=1 git push"
  echo ""
  exit 1
fi

echo "🔍 Auth isolation guard running..."

REPO_ROOT=$(git rev-parse --show-toplevel)

VIOLATIONS_FOUND=0
VIOLATION_FILES=()

# Ref format: <local ref> <local sha> <remote ref> <remote sha>
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_sha:-}" ] && continue
  # Determine range of commits to check
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    # New branch — scope to commits unique to this branch only
    MERGE_BASE=$(git merge-base origin/master HEAD 2>/dev/null)
    if [ -n "$MERGE_BASE" ]; then
      RANGE="$MERGE_BASE..$local_sha"
    else
      RANGE="$local_sha"
    fi
    DIFF_CMD="git diff --name-only $RANGE"
  else
    # Existing branch — check only new commits
    RANGE="$remote_sha..$local_sha"
    DIFF_CMD="git diff --name-only $RANGE"
  fi

  # ---------------------------------------------------------
  # Secret scan over the pushed range (new credentials only)
  # ---------------------------------------------------------
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    SCAN_BASE=$(git merge-base origin/master "$local_sha" 2>/dev/null || git rev-list --max-parents=0 "$local_sha" | tail -1)
  else
    SCAN_BASE="$remote_sha"
  fi
  if ! bash "$REPO_ROOT/scripts/secret-scan.sh" --range "$SCAN_BASE" "$local_sha"; then
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi

  # Get changed TypeScript/JavaScript files in API routes and lib
  CHANGED_FILES=$(git diff --name-only "$remote_sha" "$local_sha" 2>/dev/null \
    | grep -E '\.(ts|tsx|js|jsx)$' \
    | grep -E '^(pages/api|lib|src/services|src/modules)' \
    || true)

  if [ -z "$CHANGED_FILES" ]; then
    continue
  fi

  # Get the diff content for changed files
  DIFF_CONTENT=$(git diff "$remote_sha" "$local_sha" -- $CHANGED_FILES 2>/dev/null || true)

  if [ -z "$DIFF_CONTENT" ]; then
    continue
  fi

  # ---------------------------------------------------------
  # PATTERN 1: Hardcoded dev-user-1 (the specific bug we caught)
  # ---------------------------------------------------------
  if echo "$DIFF_CONTENT" | grep -E "^\+" | grep -qE "userId\s*=\s*['\"]dev-user-1['\"]"; then
    echo ""
    echo -e "${RED}❌ AUTH ISOLATION VIOLATION DETECTED${NC}"
    echo -e "${RED}   Pattern: hardcoded userId = 'dev-user-1'${NC}"
    echo "   This causes all users to share one data row."
    echo "   Fix: use (req as any).user?.id from withAuth middleware"
    echo ""
    
    # Show which files
    echo "$DIFF_CONTENT" | grep -n "dev-user-1" | head -5 | while IFS= read -r line; do
      echo "   → $line"
    done
    
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi

  # ---------------------------------------------------------
  # PATTERN 2: userId from req.body (privilege escalation)
  # ---------------------------------------------------------
  if echo "$DIFF_CONTENT" | grep -E "^\+" | grep -qE "userId\s*=\s*req\.body\.userId"; then
    echo ""
    echo -e "${RED}❌ PRIVILEGE ESCALATION RISK DETECTED${NC}"
    echo -e "${RED}   Pattern: userId = req.body.userId${NC}"
    echo "   This allows attackers to impersonate other users."
    echo "   Fix: use (req as any).user?.id — never accept userId from request body"
    echo ""
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi

  # ---------------------------------------------------------
  # PATTERN 3: userId hardcoded to 'admin'
  # ---------------------------------------------------------
  if echo "$DIFF_CONTENT" | grep -E "^\+" | grep -qE "userId\s*=\s*['\"]admin['\"]"; then
    echo ""
    echo -e "${RED}❌ AUTH ISOLATION VIOLATION DETECTED${NC}"
    echo -e "${RED}   Pattern: hardcoded userId = 'admin'${NC}"
    echo "   Fix: use (req as any).user?.id from withAuth middleware"
    echo ""
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi

  # ---------------------------------------------------------
  # PATTERN 4: userId hardcoded to 'system' WITHOUT being a fallback
  # (Allow: userId || 'system' — it's a safe fallback after auth check)
  # (Block: const userId = 'system' — it's hardcoded)
  # ---------------------------------------------------------
  if echo "$DIFF_CONTENT" | grep -E "^\+" | grep -qE "(const|let|var)\s+userId\s*=\s*['\"]system['\"]"; then
    echo ""
    echo -e "${YELLOW}⚠️  HARDCODED userId = 'system' DETECTED${NC}"
    echo "   If this is a fallback (userId = someId || 'system'), this is fine."
    echo "   If this is the primary assignment, it bypasses auth."
    echo "   Review: ensure userId is from (req as any).user?.id"
    echo ""
    # This is a warning, not a hard block (could be legitimate in scripts)
    # Don't increment VIOLATIONS_FOUND for this one
  fi

  # ---------------------------------------------------------
  # PATTERN 5: Audit logging hardcoded to 'System'
  # (catches: performed_by: 'System', created_by: 'System', etc.)
  # ---------------------------------------------------------
  if echo "$DIFF_CONTENT" | grep -E "^\+" | grep -qE "(performed_by|created_by|updated_by|user_name|uploadedBy|downloadedBy)\s*:\s*['\"]System['\"]"; then
    echo ""
    echo -e "${RED}❌ AUDIT LOG VIOLATION DETECTED${NC}"
    echo -e "${RED}   Pattern: audit field hardcoded to 'System'${NC}"
    echo "   This breaks compliance audit trails."
    echo "   Fix: use req.user.name from withAuth middleware"
    echo ""
    VIOLATIONS_FOUND=$((VIOLATIONS_FOUND + 1))
  fi

# Here-string, not a pipe: this loop increments VIOLATIONS_FOUND and the check
# below reads it, so running it in a subshell would discard every violation.
done <<< "$PUSH_REFS"

# =============================================================================
# RESULT
# =============================================================================

if [ "$VIOLATIONS_FOUND" -gt 0 ]; then
  echo ""
  echo -e "${RED}🚫 Push blocked: $VIOLATIONS_FOUND auth isolation violation(s) found.${NC}"
  echo ""
  echo "REQUIRED FIX:"
  echo "  userId should always come from: (req as any).user?.id"
  echo "  Acceptable fallback:            (req as any).user?.id || 'system'"
  echo "  Never:                          hardcoded strings or req.body.userId"
  echo ""
  echo "See: docs/SECURITY-CHANGELOG.md for context on the Feb 21, 2026 auth sweep."
  echo ""
  exit 1
else
  echo -e "${GREEN}✅ Auth isolation check passed — no hardcoded userId patterns found.${NC}"
  exit 0
fi
