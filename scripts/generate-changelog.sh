#!/bin/bash
# generate-changelog.sh
# Auto-generate CHANGELOG.md entries from git commits
# Usage: ./generate-changelog.sh [--since YYYY-MM-DD] [--dry-run]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG="$REPO_ROOT/CHANGELOG.md"
SINCE_DATE="2026-01-09"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --since)
      SINCE_DATE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_ROOT"

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not a git repository" >&2
  exit 1
fi

# Get commits since the specified date
commits=$(git log --since="$SINCE_DATE" --pretty=format:"%h|%ad|%s" --date=short --reverse)

if [ -z "$commits" ]; then
  echo "No commits found since $SINCE_DATE"
  exit 0
fi

# Group commits by date and categorize
declare -A dates
declare -A feat
declare -A fix
declare -A chore
declare -A refactor
declare -A docs
declare -A other

while IFS='|' read -r hash date subject; do
  dates["$date"]=1
  
  # Categorize by commit prefix
  if [[ "$subject" =~ ^[Ff]eat:.*|^[Ff]eature:.* ]]; then
    feat["$date"]+="- $subject ($hash)"$'\n'
  elif [[ "$subject" =~ ^[Ff]ix:.* ]]; then
    fix["$date"]+="- $subject ($hash)"$'\n'
  elif [[ "$subject" =~ ^[Cc]hore:.* ]]; then
    chore["$date"]+="- $subject ($hash)"$'\n'
  elif [[ "$subject" =~ ^[Rr]efactor:.* ]]; then
    refactor["$date"]+="- $subject ($hash)"$'\n'
  elif [[ "$subject" =~ ^[Dd]ocs?:.* ]]; then
    docs["$date"]+="- $subject ($hash)"$'\n'
  else
    other["$date"]+="- $subject ($hash)"$'\n'
  fi
done <<< "$commits"

# Generate changelog content
changelog_content=""

for date in $(echo "${!dates[@]}" | tr ' ' '\n' | sort -r); do
  changelog_content+="## [$date]"$'\n\n'
  
  if [ -n "${feat[$date]:-}" ]; then
    changelog_content+="### ✨ Features"$'\n'
    changelog_content+="${feat[$date]}"$'\n'
  fi
  
  if [ -n "${fix[$date]:-}" ]; then
    changelog_content+="### 🐛 Fixes"$'\n'
    changelog_content+="${fix[$date]}"$'\n'
  fi
  
  if [ -n "${refactor[$date]:-}" ]; then
    changelog_content+="### ♻️ Refactoring"$'\n'
    changelog_content+="${refactor[$date]}"$'\n'
  fi
  
  if [ -n "${docs[$date]:-}" ]; then
    changelog_content+="### 📝 Documentation"$'\n'
    changelog_content+="${docs[$date]}"$'\n'
  fi
  
  if [ -n "${chore[$date]:-}" ]; then
    changelog_content+="### 🔧 Chores"$'\n'
    changelog_content+="${chore[$date]}"$'\n'
  fi
  
  if [ -n "${other[$date]:-}" ]; then
    changelog_content+="### 📦 Other Changes"$'\n'
    changelog_content+="${other[$date]}"$'\n'
  fi
  
  changelog_content+="---"$'\n\n'
done

if [ "$DRY_RUN" = true ]; then
  echo "=== DRY RUN MODE ==="
  echo "$changelog_content"
  exit 0
fi

# Create backup
if [ -f "$CHANGELOG" ]; then
  cp "$CHANGELOG" "$CHANGELOG.backup.$(date +%Y%m%d-%H%M%S)"
fi

# Read existing changelog to preserve header and old entries
if [ -f "$CHANGELOG" ]; then
  # Extract everything after the first "## [" line
  existing_content=$(awk '/^## \[/{flag=1} flag' "$CHANGELOG")
  
  # Extract header (everything before first "## [")
  header=$(awk '/^## \[/{exit} {print}' "$CHANGELOG")
else
  header="# Changelog"$'\n\n'"All notable changes to FibreFlow will be documented in this file."$'\n\n'
  existing_content=""
fi

# Write new changelog
{
  echo "$header"
  echo "$changelog_content"
  echo "$existing_content"
} > "$CHANGELOG"

echo "✅ CHANGELOG.md updated successfully"
echo "📝 Generated entries from commits since $SINCE_DATE"
echo "💾 Backup saved to $CHANGELOG.backup.$(date +%Y%m%d-%H%M%S)"
