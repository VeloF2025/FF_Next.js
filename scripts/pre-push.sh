#!/bin/bash
# =============================================================================
# Pre-Push Hook: Auth Isolation Guard
# =============================================================================
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

echo "🔍 Auth isolation guard running..."

VIOLATIONS_FOUND=0
VIOLATION_FILES=()

# Read push info from stdin (format: <local ref> <local sha> <remote ref> <remote sha>)
while read -r local_ref local_sha remote_ref remote_sha; do
  # Determine range of commits to check
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    # New branch — check all commits
    RANGE="$local_sha"
    DIFF_CMD="git show --name-only --format= $RANGE"
  else
    # Existing branch — check only new commits
    RANGE="$remote_sha..$local_sha"
    DIFF_CMD="git diff --name-only $RANGE"
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

done

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
