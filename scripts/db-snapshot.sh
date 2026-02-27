#!/usr/bin/env bash
# ============================================================
# FibreFlow Pre-Migration Neon Snapshot
# ============================================================
# Run BEFORE any schema migration to create a named restore point.
# Usage: bash scripts/db-snapshot.sh <migration_number> [description]
# Example: bash scripts/db-snapshot.sh 216 "add_invoice_items_table"
# ============================================================

set -euo pipefail

# --- Config ---
NEON_API_KEY="napi_2afbjxk3l7jh71x10log1icm4yycl3n2hqag9wrg1jgvwqg5z955c2tnt0ip4gwx"
NEON_PROJECT_ID="sparkling-bar-47287977"
NEON_BRANCH_ID="br-summer-brook-a9jlv58r"  # production branch
NEON_API="https://console.neon.tech/api/v2"

DATE=$(date +%Y%m%d-%H%M%S)

# --- Validate args ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <migration_number> [description]"
  echo "Example: $0 216 'add_invoice_items_table'"
  exit 1
fi

MIGRATION_NUM="$1"
DESCRIPTION="${2:-migration}"
SNAPSHOT_NAME="pre-migration-${MIGRATION_NUM}-${DATE}"

echo "Creating Neon snapshot: ${SNAPSHOT_NAME}"
echo "  Project: ${NEON_PROJECT_ID}"
echo "  Branch:  ${NEON_BRANCH_ID}"
echo ""

# --- Create branch snapshot (Neon calls these "branches" from a parent) ---
# Neon's snapshot = creating a branch from the current state with a timestamp
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "${NEON_API}/projects/${NEON_PROJECT_ID}/branches" \
  -H "Authorization: Bearer ${NEON_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"branch\": {
      \"name\": \"${SNAPSHOT_NAME}\",
      \"parent_id\": \"${NEON_BRANCH_ID}\"
    },
    \"endpoints\": []
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  BRANCH_ID=$(echo "$BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "✅ Snapshot created successfully!"
  echo ""
  echo "  Name:      ${SNAPSHOT_NAME}"
  echo "  Branch ID: ${BRANCH_ID}"
  echo "  Time:      $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  RESTORE INSTRUCTIONS (if migration fails)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "  Option 1: Reset production branch to this snapshot"
  echo "  ─────────────────────────────────────────────────"
  echo "  npx neonctl branches reset ${NEON_BRANCH_ID} \\"
  echo "    --project-id ${NEON_PROJECT_ID} \\"
  echo "    --parent ${BRANCH_ID}"
  echo ""
  echo "  Option 2: Point app at snapshot branch temporarily"
  echo "  ─────────────────────────────────────────────────"
  echo "  1. Create an endpoint on the snapshot branch in Neon Console"
  echo "  2. Update DATABASE_URL in .env.local to point to the snapshot endpoint"
  echo "  3. Restart the app service"
  echo ""
  echo "  Option 3: Use Neon Console PITR"
  echo "  ───────────────────────────────"
  echo "  1. Go to Neon Console → Branches → production"
  echo "  2. Click 'Restore' → select time before migration"
  echo "  3. Restore creates a new branch — verify, then reset production"
  echo ""
else
  echo "❌ Failed to create snapshot (HTTP ${HTTP_CODE})"
  echo ""
  echo "Response:"
  echo "$BODY" | head -20
  echo ""
  echo "Troubleshooting:"
  echo "  - Check NEON_API_KEY is valid"
  echo "  - Check project/branch IDs"
  echo "  - Check Neon API status: https://neon.tech/status"
  exit 1
fi
