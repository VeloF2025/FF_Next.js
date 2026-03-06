#!/bin/bash
# Pre-commit hook: Detect req.body.userId auth vulnerability pattern
# 
# Prevents commits with dangerous auth patterns:
# - req.body.userId (direct assignment from request body)
# - req.body.user, req.body.uid, etc.
#
# Usage:
#   Install: cp scripts/pre-commit-auth-check.sh .git/hooks/pre-commit
#   Test: git commit (will block if violations found)
#
# To bypass (NOT RECOMMENDED): git commit --no-verify

set -e

# ANSI colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Dangerous patterns to detect
DANGEROUS_PATTERNS=(
  "req\.body\.userId"
  "req\.body\.user[^a-zA-Z]"
  "req\.body\.uid"
  "req\.body\.id[^a-zA-Z]"
)

VIOLATIONS=0
CHECKED_FILES=0

# Get list of staged TypeScript files in pages/api/
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E "pages/api/.*\.(ts|tsx)$" || true)

if [ -z "$STAGED_FILES" ]; then
  # No API files staged, exit cleanly
  exit 0
fi

echo -e "${YELLOW}🔒 Auth vulnerability check (pre-commit)${NC}"
echo "Scanning staged API files for dangerous patterns..."
echo ""

for file in $STAGED_FILES; do
  CHECKED_FILES=$((CHECKED_FILES + 1))
  
  # Get the staged content (not working directory)
  CONTENT=$(git show ":$file" 2>/dev/null || echo "")
  
  if [ -z "$CONTENT" ]; then
    continue
  fi
  
  # Check each dangerous pattern
  for pattern in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$CONTENT" | grep -E "$pattern" > /dev/null 2>&1; then
      if [ $VIOLATIONS -eq 0 ]; then
        echo -e "${RED}❌ SECURITY VIOLATIONS DETECTED${NC}"
        echo ""
      fi
      
      # Extract line numbers and context
      LINE_NUMS=$(echo "$CONTENT" | grep -nE "$pattern" | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')
      
      echo -e "${RED}File: $file${NC}"
      echo -e "${YELLOW}Lines: $LINE_NUMS${NC}"
      echo -e "${YELLOW}Pattern: '$pattern'${NC}"
      echo ""
      echo "🚨 SECURITY RULE: User identity must ALWAYS come from req.user (JWT),"
      echo "                never from request body (req.body.userId, req.body.user, etc.)"
      echo ""
      echo "✅ SECURE PATTERN:"
      echo "   const userId = req.user.id;  // From AuthenticatedNextApiRequest"
      echo ""
      echo "❌ DANGEROUS PATTERNS (DO NOT USE):"
      echo "   const userId = req.body.userId || req.user?.id;"
      echo "   const userId = req.user?.id || req.body.userId;"
      echo "   const userId = req.body.userId;"
      echo ""
      echo "📖 Documentation: GUARDRAILS.md — AUTH: User Identity ALWAYS from JWT"
      echo ""
      
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

if [ $VIOLATIONS -gt 0 ]; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}❌ COMMIT BLOCKED: $VIOLATIONS auth violation(s) found${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo "To fix:"
  echo "  1. Update the files above to use req.user.id only"
  echo "  2. Use AuthenticatedNextApiRequest type for proper typing"
  echo "  3. Stage the fixed files: git add <files>"
  echo "  4. Commit again: git commit"
  echo ""
  echo "To bypass (NOT RECOMMENDED): git commit --no-verify"
  echo ""
  exit 1
fi

if [ $CHECKED_FILES -gt 0 ]; then
  echo -e "${GREEN}✅ Auth check passed ($CHECKED_FILES API file(s) scanned)${NC}"
  echo ""
fi

exit 0
