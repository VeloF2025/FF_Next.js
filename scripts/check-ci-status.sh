#!/bin/bash
# =============================================================================
# check-ci-status.sh — GitHub Actions CI Health Monitor for FibreFlow
# =============================================================================
# Checks VelocityFibre/FF_Next.js workflow runs for failures, billing errors,
# or timeouts. Designed for use in heartbeat checks and pre-deploy validation.
#
# Usage:
#   bash scripts/check-ci-status.sh              # check latest runs
#   bash scripts/check-ci-status.sh --verbose    # show full run details
#   bash scripts/check-ci-status.sh --billing    # check only billing errors
#
# Exit code: 0 = CI healthy, 1 = failures detected
# =============================================================================

VERBOSE=false
BILLING_ONLY=false
REPO="VelocityFibre/FF_Next.js"
RUNS_TO_CHECK=5

for arg in "$@"; do
  case $arg in
    --verbose) VERBOSE=true ;;
    --billing) BILLING_ONLY=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "============================================="
echo "  GitHub Actions CI Status — $REPO"
echo "  $(date '+%Y-%m-%d %H:%M %Z')"
echo "============================================="

# Verify gh CLI is available and authenticated
if ! command -v gh &> /dev/null; then
  echo -e "${RED}❌ gh CLI not found — cannot check CI status${NC}"
  exit 1
fi

# Get recent runs
RUNS=$(gh run list --repo "$REPO" --limit "$RUNS_TO_CHECK" --json status,conclusion,name,createdAt,databaseId,workflowName 2>/dev/null)

if [ -z "$RUNS" ] || [ "$RUNS" = "[]" ]; then
  echo -e "${YELLOW}⚠️  No workflow runs found (API error or no runs)${NC}"
  exit 1
fi

# Parse with python3
ANALYSIS=$(echo "$RUNS" | python3 -c "
import json, sys
from datetime import datetime, timezone

runs = json.load(sys.stdin)
total = len(runs)
failing = [r for r in runs if r.get('conclusion') == 'failure']
success = [r for r in runs if r.get('conclusion') == 'success']
pending = [r for r in runs if r.get('status') in ('in_progress','queued','waiting')]

all_failing = len(failing) == total and total > 0
billing_hint = all_failing  # billing errors = all jobs fail with no output

print(f'TOTAL={total}')
print(f'FAILING={len(failing)}')
print(f'SUCCESS={len(success)}')
print(f'PENDING={len(pending)}')
print(f'ALL_FAILING={all_failing}')

for r in runs[:5]:
    status = r.get('conclusion') or r.get('status','?')
    ts = r.get('createdAt','')[:16].replace('T',' ')
    name = r.get('workflowName', r.get('name','?'))[:35]
    rid = r.get('databaseId','?')
    icon = '✅' if status == 'success' else ('❌' if status == 'failure' else '⏳')
    print(f'RUN|{icon}|{status:10}|{name:35}|{ts}|{rid}')
")

TOTAL=$(echo "$ANALYSIS" | grep "^TOTAL=" | cut -d= -f2)
FAILING=$(echo "$ANALYSIS" | grep "^FAILING=" | cut -d= -f2)
SUCCESS=$(echo "$ANALYSIS" | grep "^SUCCESS=" | cut -d= -f2)
ALL_FAILING=$(echo "$ANALYSIS" | grep "^ALL_FAILING=" | cut -d= -f2)

echo ""
echo "Recent runs (last $TOTAL):"
echo "$ANALYSIS" | grep "^RUN|" | while IFS='|' read -r _ icon status name ts rid; do
  echo "  $icon [$status] $name  ($ts)"
done

echo ""
echo "Summary: $SUCCESS passed, $FAILING failed of $TOTAL runs"
echo ""

# Billing error detection — check annotations on most recent failure
if [ "$ALL_FAILING" = "True" ]; then
  LATEST_RUN_ID=$(echo "$RUNS" | python3 -c "
import json,sys
runs=json.load(sys.stdin)
failing=[r for r in runs if r.get('conclusion')=='failure']
if failing: print(failing[0]['databaseId'])
" 2>/dev/null)

  if [ -n "$LATEST_RUN_ID" ]; then
    ANNOTATIONS=$(gh run view "$LATEST_RUN_ID" --repo "$REPO" 2>/dev/null | grep -i "payment\|billing\|spending\|limit" | head -3)
    if [ -n "$ANNOTATIONS" ]; then
      echo -e "${RED}⚠️  BILLING FAILURE DETECTED:${NC}"
      echo "$ANNOTATIONS" | while read -r line; do echo "  $line"; done
      echo ""
      echo "  Fix: GitHub Settings → Billing & plans for VelocityFibre org"
      echo -e "${RED}❌ CI STATUS: BILLING OUTAGE${NC}"
      exit 1
    fi
  fi

  echo -e "${RED}❌ CI STATUS: ALL RUNS FAILING — investigate immediately${NC}"
  [ "$VERBOSE" = true ] && gh run view "$LATEST_RUN_ID" --repo "$REPO" 2>/dev/null | tail -20
  exit 1

elif [ "$FAILING" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  CI STATUS: SOME FAILURES ($FAILING/$TOTAL runs)${NC}"
  exit 1

else
  echo -e "${GREEN}✅ CI STATUS: HEALTHY ($SUCCESS/$TOTAL runs passing)${NC}"
  exit 0
fi
