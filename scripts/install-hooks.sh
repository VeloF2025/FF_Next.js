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

# pre-push: Auth isolation guard
if [ -f "$SCRIPTS_DIR/pre-push.sh" ]; then
  cp "$SCRIPTS_DIR/pre-push.sh" "$HOOKS_DIR/pre-push"
  chmod +x "$HOOKS_DIR/pre-push"
  echo -e "${GREEN}✅ pre-push hook installed${NC} (auth isolation guard)"
else
  echo -e "${YELLOW}⚠️  scripts/pre-push.sh not found — skipping${NC}"
fi

echo ""
echo "Hooks installed. These will run automatically on git push."
echo "To bypass (emergency only): git push --no-verify"
