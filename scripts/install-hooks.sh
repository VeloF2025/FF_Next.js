#!/bin/bash
# =============================================================================
# Install Git Hooks for FibreFlow
# =============================================================================
# Run this once after cloning or when hooks are updated.
# Usage: bash scripts/install-hooks.sh
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

HOOKS_DIR=".git/hooks"
SCRIPTS_DIR="scripts"

echo "📎 Installing FibreFlow git hooks..."

# pre-commit: Secret scanner
if [ -f "$SCRIPTS_DIR/pre-commit.sh" ]; then
  cp "$SCRIPTS_DIR/pre-commit.sh" "$HOOKS_DIR/pre-commit"
  chmod +x "$HOOKS_DIR/pre-commit"
  echo -e "${GREEN}✅ pre-commit hook installed${NC} (secret scanner)"
else
  echo -e "${YELLOW}⚠️  scripts/pre-commit.sh not found — skipping${NC}"
fi

# pre-push: Auth isolation guard (+ secret scan on pushed range)
if [ -f "$SCRIPTS_DIR/pre-push.sh" ]; then
  cp "$SCRIPTS_DIR/pre-push.sh" "$HOOKS_DIR/pre-push"
  chmod +x "$HOOKS_DIR/pre-push"
  echo -e "${GREEN}✅ pre-push hook installed${NC} (auth isolation guard + secret scan)"
else
  echo -e "${YELLOW}⚠️  scripts/pre-push.sh not found — skipping${NC}"
fi

echo ""
echo "Hooks installed. pre-commit runs on commit; pre-push runs on push."
echo "To bypass (emergency only — never for real secrets): --no-verify"
