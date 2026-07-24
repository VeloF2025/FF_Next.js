#!/usr/bin/env bash
# H&S migration-chain rebuild proof (goal §7.11 / D6 acceptance).
#
# Spins up a throwaway Postgres 15 container, creates minimal stubs for the
# non-H&S tables the chain references (projects/staff/users/contractors — all
# uuid ids, matching live), applies the H&S-relevant migrations in order:
#   113 -> 235 -> 236 -> 237 -> 238 -> sql/449 -> sql/450 -> sql/451 -> sql/452 -> sql/453 -> sql/454 -> sql/455 -> sql/456
# then diffs the resulting hs_* schema (columns + indexes) against the live
# database. Before 449/450 are applied to live, the diff should list exactly
# their pending changes; after the gated live apply it must be empty.
#
# Usage:
#   LIVE_DATABASE_URL=postgresql://... bash scripts/hs-scratch-rebuild-proof.sh
#
# Read-only against live. The container is removed on exit.

set -euo pipefail

MIG_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"
SCRATCH_PORT="${SCRATCH_PORT:-55433}"
CONTAINER="hs-scratch-pg-$$"
SCRATCH_URL="postgresql://postgres:scratch@127.0.0.1:${SCRATCH_PORT}/postgres"

if [ -z "${LIVE_DATABASE_URL:-}" ]; then
  echo "LIVE_DATABASE_URL is required (read-only schema comparison)" >&2
  exit 1
fi

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f /tmp/hs-schema-scratch.txt /tmp/hs-schema-live.txt /tmp/hs-schema-diff.txt
}
trap cleanup EXIT

echo "[1/5] Starting scratch Postgres 15 on :${SCRATCH_PORT}..."
docker run --rm -d --name "$CONTAINER" -e POSTGRES_PASSWORD=scratch \
  -p "${SCRATCH_PORT}:5432" postgres:15 >/dev/null
for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[2/5] Creating dependency stubs (uuid ids, matching live)..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE projects   (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_name TEXT);
CREATE TABLE staff      (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE users      (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
CREATE TABLE contractors(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_name TEXT);
CREATE TABLE team_members(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), first_name TEXT, last_name TEXT);
SQL

echo "[3/5] Applying H&S migration chain..."
for f in \
  "$MIG_DIR/113_health_safety_module.sql" \
  "$MIG_DIR/235_hs_capa.sql" \
  "$MIG_DIR/236_hs_ticket_details_full.sql" \
  "$MIG_DIR/237_hs_risk_register.sql" \
  "$MIG_DIR/238_hs_project_config_columns.sql" \
  "$MIG_DIR/sql/449_hs_contractor_schema_reconciliation.sql" \
  "$MIG_DIR/sql/450_hs_checklist_seed_44.sql" \
  "$MIG_DIR/sql/451_hs_training_matrix.sql" \
  "$MIG_DIR/sql/452_hs_toolbox_talks.sql" \
  "$MIG_DIR/sql/453_hs_ppe_register.sql" \
  "$MIG_DIR/sql/454_hs_permits.sql" \
  "$MIG_DIR/sql/455_hs_appointment_letters.sql" \
  "$MIG_DIR/sql/456_hs_ltifr.sql"
do
  echo "    -> $(basename "$f")"
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

SEEDED=$(psql "$SCRATCH_URL" -t -A -c "SELECT count(*) FROM hs_checklist_items;")
echo "    seeded checklist items: $SEEDED (expected 44)"

echo "[4/5] Comparing hs_* schema (columns + indexes) scratch vs live..."
SCHEMA_SQL="
SELECT table_name||'.'||column_name||':'||data_type||':'||is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name LIKE 'hs\\_%'
ORDER BY 1;
SELECT indexname||' ON '||tablename
FROM pg_indexes
WHERE schemaname='public' AND tablename LIKE 'hs\\_%'
ORDER BY 1;
"
psql "$SCRATCH_URL" -t -A -c "$SCHEMA_SQL" > /tmp/hs-schema-scratch.txt
psql "$LIVE_DATABASE_URL" -t -A -c "$SCHEMA_SQL" > /tmp/hs-schema-live.txt

echo "[5/5] Diff (lines prefixed '<' exist only in LIVE, '>' only in the rebuilt chain):"
if diff /tmp/hs-schema-live.txt /tmp/hs-schema-scratch.txt > /tmp/hs-schema-diff.txt; then
  echo "    ✓ EXACT PARITY — rebuilt chain matches the live hs_* schema."
else
  sed 's/^/    /' /tmp/hs-schema-diff.txt
  echo "    (Before 449/450 are applied to live, the expected diff is exactly"
  echo "     the 449 additions: hs_contractor_documents.*, compliance gate/score"
  echo "     columns, and the two new unique indexes. Anything else is drift.)"
fi
