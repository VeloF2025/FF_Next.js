#!/usr/bin/env bash
# check-commit-size.sh — Enforce commit size policy
# Usage: bash scripts/check-commit-size.sh [--staged | --commit <SHA>]
#
# Policy:
#   ALERT: >1000 lines changed
#   BLOCK: >2000 lines changed
#
# Exit codes:
#   0 = OK
#   1 = ALERT (warning, not blocking)
#   2 = BLOCK (commit too large, enforce split)

set -euo pipefail

ALERT_THRESHOLD=1000
BLOCK_THRESHOLD=2000
MODE="${1:-}"
COMMIT="${2:-}"

# Determine line count
if [[ "$MODE" == "--staged" ]]; then
  LINES=$(git diff --cached --shortstat 2>/dev/null | awk '{
    ins = 0; del = 0
    for(i=1;i<=NF;i++){
      if($i~/insertion/) ins=$(i-1)
      if($i~/deletion/) del=$(i-1)
    }
    print ins + del
  }')
  LABEL="staged changes"
elif [[ "$MODE" == "--commit" && -n "$COMMIT" ]]; then
  LINES=$(git show --shortstat "$COMMIT" 2>/dev/null | tail -1 | awk '{
    ins = 0; del = 0
    for(i=1;i<=NF;i++){
      if($i~/insertion/) ins=$(i-1)
      if($i~/deletion/) del=$(i-1)
    }
    print ins + del
  }')
  LABEL="commit $COMMIT"
else
  # Default: check last commit
  LINES=$(git diff HEAD~1 HEAD --shortstat 2>/dev/null | awk '{
    ins = 0; del = 0
    for(i=1;i<=NF;i++){
      if($i~/insertion/) ins=$(i-1)
      if($i~/deletion/) del=$(i-1)
    }
    print ins + del
  }')
  LABEL="last commit"
fi

LINES="${LINES:-0}"

echo "Commit size check: $LINES lines changed in $LABEL"

if [[ "$LINES" -ge "$BLOCK_THRESHOLD" ]]; then
  echo ""
  echo "❌ BLOCKED: $LINES lines exceeds the $BLOCK_THRESHOLD line limit."
  echo ""
  echo "Policy: One module per commit. Large commits:"
  echo "  - Mix unrelated modules (hard to review, hard to revert)"
  echo "  - Increase blast radius on rollback"
  echo "  - Hide bugs in noise"
  echo ""
  echo "Split this commit into smaller, focused commits:"
  echo "  git reset HEAD~1                    # undo last commit"
  echo "  git add <module-A-files>            # stage one module"
  echo "  git commit -m 'feat(module-a): ...' # commit it"
  echo "  git add <module-B-files>            # next module"
  echo "  git commit -m 'feat(module-b): ...' # commit it"
  echo ""
  exit 2
elif [[ "$LINES" -ge "$ALERT_THRESHOLD" ]]; then
  echo ""
  echo "⚠️  ALERT: $LINES lines is large (limit: $BLOCK_THRESHOLD). Consider splitting into per-module commits."
  echo "   This commit will not be blocked but Forge code review will flag it."
  echo ""
  exit 1
else
  echo "✅ OK: $LINES lines — within policy limits."
  exit 0
fi
