#!/bin/bash
# Count TypeScript errors in the project
# Usage: ./scripts/count-typescript-errors.sh [--breakdown] [--by-area]

set -e

BREAKDOWN=false
BY_AREA=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --breakdown) BREAKDOWN=true; shift ;;
    --by-area) BY_AREA=true; shift ;;
    *) shift ;;
  esac
done

echo "Running TypeScript type check..."
ERRORS=$(npx tsc --noEmit 2>&1)
TOTAL=$(echo "$ERRORS" | grep -c "error TS" || echo 0)

echo "═══════════════════════════════════════"
echo "TypeScript Error Count: $TOTAL"
echo "═══════════════════════════════════════"
echo ""

if [ "$BREAKDOWN" = true ]; then
  echo "Top files by error count:"
  echo "$ERRORS" | grep "error TS" | sed 's|/home/hein/Workspace/FF_Next.js/||' | awk -F'(' '{print $1}' | sort | uniq -c | sort -rn | head -20
  echo ""
fi

if [ "$BY_AREA" = true ]; then
  echo "Errors by directory:"
  echo "$ERRORS" | grep "error TS" | awk -F'(' '{print $1}' | sort | uniq -c | awk '{
    prefix = $2
    if (prefix ~ /^convex\//) area = "convex"
    else if (prefix ~ /^tools\//) area = "tools"
    else if (prefix ~ /^neon\//) area = "neon"
    else if (prefix ~ /^scripts\//) area = "scripts"
    else if (prefix ~ /^pages\//) area = "pages"
    else if (prefix ~ /^app\//) area = "app"
    else if (prefix ~ /^src\//) area = "src"
    else area = "other"
    counts[area] += $1
  } END {
    for (a in counts) printf "%6d  %s\n", counts[a], a
  }' | sort -rn
  echo ""
fi

# Compare to baseline
BASELINE=5681
DELTA=$((TOTAL - BASELINE))

echo "Baseline: $BASELINE"
echo "Current:  $TOTAL"
if [ $DELTA -gt 0 ]; then
  echo "Delta:    +$DELTA (⚠️ REGRESSION)"
else
  echo "Delta:    $DELTA (✅ IMPROVEMENT)"
fi
