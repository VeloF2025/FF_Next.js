#!/bin/bash
# Install pre-commit hook for auth vulnerability detection
# 
# Usage: bash scripts/setup-auth-hook.sh
# 
# This script installs a pre-commit hook that prevents commits containing
# the req.body.userId auth vulnerability pattern.

set -e

HOOK_SOURCE="scripts/pre-commit-auth-check.sh"
HOOK_DEST=".git/hooks/pre-commit"

if [ ! -f "$HOOK_SOURCE" ]; then
  echo "❌ Error: $HOOK_SOURCE not found"
  echo "Run this script from the repository root: bash scripts/setup-auth-hook.sh"
  exit 1
fi

echo "📦 Installing auth vulnerability pre-commit hook..."
echo ""

# Check if hook already exists
if [ -f "$HOOK_DEST" ]; then
  echo "⚠️  Existing pre-commit hook found"
  read -p "Overwrite? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 1
  fi
fi

# Copy hook
cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "✅ Hook installed successfully!"
echo ""
echo "Next commit will be checked for auth vulnerabilities."
echo "To test: git commit --allow-empty -m 'test: auth hook verification'"
echo ""
echo "To bypass (NOT RECOMMENDED): git commit --no-verify"
echo ""
echo "📖 Documentation: docs/AUTH_HOOK_SETUP.md"
