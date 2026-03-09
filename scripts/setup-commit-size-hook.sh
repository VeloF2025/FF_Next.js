#!/usr/bin/env bash
# setup-commit-size-hook.sh — Install commit size pre-commit hook
# Run from repo root: bash scripts/setup-commit-size-hook.sh

set -euo pipefail

HOOK_FILE=".git/hooks/pre-commit"
REPO_ROOT="$(git rev-parse --show-toplevel)"

echo "Installing commit size pre-commit hook..."

# Check if pre-commit hook already exists (e.g., auth check hook)
if [[ -f "$REPO_ROOT/$HOOK_FILE" ]]; then
  echo "Existing pre-commit hook found — appending commit size check..."
  cat >> "$REPO_ROOT/$HOOK_FILE" << 'EOF'

# --- Commit size policy check ---
RESULT=0
bash "$(git rev-parse --show-toplevel)/scripts/check-commit-size.sh" --staged || RESULT=$?
if [[ "$RESULT" -eq 2 ]]; then
  echo "Commit blocked: split into smaller per-module commits."
  exit 1
fi
# (RESULT=1 = alert only, allow commit through)
EOF
else
  cat > "$REPO_ROOT/$HOOK_FILE" << 'EOF'
#!/usr/bin/env bash
# pre-commit hook: commit size policy enforcement

RESULT=0
bash "$(git rev-parse --show-toplevel)/scripts/check-commit-size.sh" --staged || RESULT=$?
if [[ "$RESULT" -eq 2 ]]; then
  echo "Commit blocked: split into smaller per-module commits."
  exit 1
fi
EOF
fi

chmod +x "$REPO_ROOT/$HOOK_FILE"
echo "✅ Commit size hook installed at $HOOK_FILE"
echo ""
echo "Policy:"
echo "  ALERT: >1000 lines changed"
echo "  BLOCK: >2000 lines changed"
echo "  Override (emergency only): git commit --no-verify"
