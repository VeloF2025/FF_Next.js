#!/bin/bash
# KB Freshness Check — Detect stale knowledge base files
# Reports files older than threshold and suggests updates
#
# Usage:
#   bash scripts/kb-freshness-check.sh                    # Default 30 days
#   bash scripts/kb-freshness-check.sh 60                 # Custom threshold
#   bash scripts/kb-freshness-check.sh --json             # JSON output
#   bash scripts/kb-freshness-check.sh --report           # Save to file
#
# Exit codes:
#   0 - All KB files fresh
#   1 - Stale files found
#   2 - Error

set -euo pipefail

# Configuration
KB_DIR=".claude/knowledge-base"
DOCS_DIR="docs"
DEFAULT_THRESHOLD_DAYS=30
REPORT_DIR="reports"

# Parse arguments
THRESHOLD=${1:-$DEFAULT_THRESHOLD_DAYS}
OUTPUT_FORMAT="text"
SAVE_REPORT=false

if [[ "$THRESHOLD" == "--json" ]]; then
    OUTPUT_FORMAT="json"
    THRESHOLD=$DEFAULT_THRESHOLD_DAYS
elif [[ "$THRESHOLD" == "--report" ]]; then
    SAVE_REPORT=true
    THRESHOLD=$DEFAULT_THRESHOLD_DAYS
fi

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

# Check if directories exist
if [[ ! -d "$KB_DIR" ]]; then
    echo "ERROR: Knowledge base directory not found: $KB_DIR" >&2
    exit 2
fi

# Find stale files
STALE_FILES=()
FRESH_FILES=()
THRESHOLD_SECONDS=$((THRESHOLD * 86400))
CURRENT_TIME=$(date +%s)

# Function to check file freshness
check_file() {
    local file=$1
    local mod_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
    local age_seconds=$((CURRENT_TIME - mod_time))
    local age_days=$((age_seconds / 86400))
    
    if [[ $age_seconds -gt $THRESHOLD_SECONDS ]]; then
        STALE_FILES+=("$file|$age_days")
    else
        FRESH_FILES+=("$file|$age_days")
    fi
}

# Scan KB files
while IFS= read -r -d '' file; do
    check_file "$file"
done < <(find "$KB_DIR" -type f -name "*.md" -print0)

# Scan docs files (optional)
if [[ -d "$DOCS_DIR" ]]; then
    while IFS= read -r -d '' file; do
        check_file "$file"
    done < <(find "$DOCS_DIR" -type f -name "*.md" -print0)
fi

# Calculate stats
TOTAL_FILES=$((${#STALE_FILES[@]} + ${#FRESH_FILES[@]}))
STALE_COUNT=${#STALE_FILES[@]}
FRESH_COUNT=${#FRESH_FILES[@]}
STALE_PERCENT=0
if [[ $TOTAL_FILES -gt 0 ]]; then
    STALE_PERCENT=$((STALE_COUNT * 100 / TOTAL_FILES))
fi

# Output results
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
    # JSON output
    echo "{"
    echo "  \"threshold_days\": $THRESHOLD,"
    echo "  \"total_files\": $TOTAL_FILES,"
    echo "  \"stale_count\": $STALE_COUNT,"
    echo "  \"fresh_count\": $FRESH_COUNT,"
    echo "  \"stale_percent\": $STALE_PERCENT,"
    echo "  \"stale_files\": ["
    for i in "${!STALE_FILES[@]}"; do
        IFS='|' read -r file age <<< "${STALE_FILES[$i]}"
        echo "    {\"file\": \"$file\", \"age_days\": $age}$([ $i -lt $((STALE_COUNT - 1)) ] && echo ",")"
    done
    echo "  ]"
    echo "}"
else
    # Text output
    echo "======================================"
    echo "  KB Freshness Report"
    echo "  Threshold: $THRESHOLD days"
    echo "  Date: $(date '+%Y-%m-%d %H:%M')"
    echo "======================================"
    echo ""
    echo "Summary:"
    echo "  Total files: $TOTAL_FILES"
    echo "  Fresh files: $FRESH_COUNT"
    echo "  Stale files: $STALE_COUNT ($STALE_PERCENT%)"
    echo ""
    
    if [[ $STALE_COUNT -gt 0 ]]; then
        echo -e "${YELLOW}⚠ Stale Files (> $THRESHOLD days):${NC}"
        echo ""
        
        # Sort by age (descending)
        IFS=$'\n' sorted=($(sort -t'|' -k2 -rn <<<"${STALE_FILES[*]}"))
        unset IFS
        
        for item in "${sorted[@]}"; do
            IFS='|' read -r file age <<< "$item"
            echo -e "  ${RED}[${age}d]${NC} $file"
        done
        echo ""
        echo "Recommendation: Review and update these files or archive if obsolete."
    else
        echo -e "${GREEN}✅ All files are fresh! (< $THRESHOLD days)${NC}"
    fi
    echo ""
fi

# Save report if requested
if [[ "$SAVE_REPORT" == "true" ]]; then
    mkdir -p "$REPORT_DIR"
    REPORT_FILE="$REPORT_DIR/kb-freshness-$(date +%Y-%m-%d).md"
    
    {
        echo "# KB Freshness Report — $(date '+%Y-%m-%d %H:%M')"
        echo ""
        echo "**Threshold:** $THRESHOLD days"
        echo ""
        echo "## Summary"
        echo "- **Total files:** $TOTAL_FILES"
        echo "- **Fresh:** $FRESH_COUNT"
        echo "- **Stale:** $STALE_COUNT ($STALE_PERCENT%)"
        echo ""
        
        if [[ $STALE_COUNT -gt 0 ]]; then
            echo "## Stale Files"
            echo ""
            echo "| Age (days) | File |"
            echo "|------------|------|"
            
            IFS=$'\n' sorted=($(sort -t'|' -k2 -rn <<<"${STALE_FILES[*]}"))
            unset IFS
            
            for item in "${sorted[@]}"; do
                IFS='|' read -r file age <<< "$item"
                echo "| $age | \`$file\` |"
            done
            echo ""
            echo "**Action Required:** Review and update stale files."
        else
            echo "✅ All files are fresh!"
        fi
    } > "$REPORT_FILE"
    
    echo "Report saved to: $REPORT_FILE"
fi

# Exit with appropriate code
if [[ $STALE_COUNT -gt 0 ]]; then
    exit 1
else
    exit 0
fi
