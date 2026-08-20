#!/usr/bin/env bash
# Migration 504 (hs_daily_checkins.work_location) — live-Postgres proof.
#
# The vitest suite for this migration only asserts the SQL text is spelled
# right (no live-Postgres harness exists in that test tree). A regex cannot
# prove a CHECK constraint actually rejects a row, so this script — modelled
# on scripts/hs-scratch-rebuild-proof.sh — spins up a throwaway Postgres 15,
# creates the minimal stub tables hs_daily_checkins depends on, applies the
# migration chain far enough to create the table (237 for hs_risk_register,
# then 465 + 466 for hs_daily_checkins itself), applies 504, and proves all
# four behaviours by actually inserting rows. Then it applies rollback_504
# and re-applies 504, proving both directions are clean.
#
# Never points at the shared production database. Ephemeral host port —
# Docker picks it, read back with `docker port`. Container removed on exit.
#
# Usage: bash scripts/hs-checkin-work-location-proof.sh

set -euo pipefail

MIG_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"
CONTAINER="hs-wl-proof-$$"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

echo "[1/6] Starting scratch Postgres 15 on an ephemeral port..."
docker run --rm -d --name "$CONTAINER" -e POSTGRES_PASSWORD=changeme \
  -p 127.0.0.1::5432 postgres:15 >/dev/null
HOST_PORT="$(docker port "$CONTAINER" 5432/tcp | head -1 | cut -d: -f2)"
[ -n "$HOST_PORT" ] || fail "could not read back the assigned host port"
SCRATCH_URL="postgresql://postgres:changeme@127.0.0.1:${HOST_PORT}/postgres"
echo "    assigned port: ${HOST_PORT}"

for i in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "[2/6] Creating dependency stubs..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE projects   (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_name TEXT);
CREATE TABLE staff      (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT);
CREATE TABLE users      (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
CREATE TABLE contractors(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), company_name TEXT);
CREATE TABLE team_members(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), first_name TEXT, last_name TEXT);
SQL

echo "[3/6] Applying migration chain up to hs_daily_checkins (237, 465, 466)..."
for f in \
  "$MIG_DIR/237_hs_risk_register.sql" \
  "$MIG_DIR/sql/465_hs_daily_checkins.sql" \
  "$MIG_DIR/sql/466_hs_daily_checkins_review_fixes.sql"
do
  echo "    -> $(basename "$f")"
  psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "    seeding one pre-existing row (pre-504, all site declarations)..."
PROJECT_ID=$(psql "$SCRATCH_URL" -t -A -c "INSERT INTO projects (project_name) VALUES ('P1') RETURNING id;" | head -1)
STAFF_ID=$(psql "$SCRATCH_URL" -t -A -c "INSERT INTO staff (name) VALUES ('S1') RETURNING id;" | head -1)
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -c "
INSERT INTO hs_daily_checkins
  (checkin_date, project_id, staff_id, worker_name, capture_mode, submission_id,
   fit_for_duty, ppe_complete, clearance)
VALUES
  (CURRENT_DATE, '${PROJECT_ID}', '${STAFF_ID}', 'Pre-existing Worker', 'self', gen_random_uuid(),
   true, true, 'cleared')
"

echo "[4/6] Applying 504..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$MIG_DIR/sql/504_hs_checkin_work_location.sql"

echo "[5/6] Proving the four behaviours..."

echo "  (a) pre-existing row defaults to 'site'..."
WL=$(psql "$SCRATCH_URL" -t -A -c "SELECT work_location FROM hs_daily_checkins WHERE worker_name = 'Pre-existing Worker';")
[ "$(echo "$WL" | tr -d '[:space:]')" = "site" ] || fail "pre-existing row did not default to 'site' (got: $WL)"
echo "      OK: work_location = site"

echo "  (b) office row with NULL project succeeds..."
STAFF_OFFICE=$(psql "$SCRATCH_URL" -t -A -c "INSERT INTO staff (name) VALUES ('Office') RETURNING id;" | head -1)
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -c "
INSERT INTO hs_daily_checkins
  (checkin_date, project_id, work_location, staff_id, worker_name, capture_mode, submission_id,
   fit_for_duty, ppe_complete, clearance)
VALUES
  (CURRENT_DATE, NULL, 'office', '${STAFF_OFFICE}', 'Office Worker', 'self', gen_random_uuid(),
   true, true, 'cleared')
" || fail "office row with NULL project was rejected — should have succeeded"
echo "      OK: office row inserted"

echo "  (c) site row with NULL project is rejected by hs_daily_checkins_site_needs_project..."
STAFF_BADSITE=$(psql "$SCRATCH_URL" -t -A -c "INSERT INTO staff (name) VALUES ('BadSite') RETURNING id;" | head -1)
ERR=$(psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -c "
INSERT INTO hs_daily_checkins
  (checkin_date, project_id, work_location, staff_id, worker_name, capture_mode, submission_id,
   fit_for_duty, ppe_complete, clearance)
VALUES
  (CURRENT_DATE, NULL, 'site', '${STAFF_BADSITE}', 'Bad Site Worker', 'self', gen_random_uuid(),
   true, true, 'cleared')
" 2>&1) && fail "site row with NULL project was accepted — should have been rejected"
echo "$ERR" | grep -q "hs_daily_checkins_site_needs_project" \
  || fail "rejection did not name hs_daily_checkins_site_needs_project (got: $ERR)"
echo "      OK: rejected, naming hs_daily_checkins_site_needs_project"

echo "  (d) unknown work_location is rejected by hs_daily_checkins_work_location_check..."
STAFF_MOON=$(psql "$SCRATCH_URL" -t -A -c "INSERT INTO staff (name) VALUES ('Moon') RETURNING id;" | head -1)
ERR=$(psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -c "
INSERT INTO hs_daily_checkins
  (checkin_date, project_id, work_location, staff_id, worker_name, capture_mode, submission_id,
   fit_for_duty, ppe_complete, clearance)
VALUES
  (CURRENT_DATE, '${PROJECT_ID}', 'moon', '${STAFF_MOON}', 'Moon Worker', 'self', gen_random_uuid(),
   true, true, 'cleared')
" 2>&1) && fail "work_location='moon' was accepted — should have been rejected"
echo "$ERR" | grep -q "hs_daily_checkins_work_location_check" \
  || fail "rejection did not name hs_daily_checkins_work_location_check (got: $ERR)"
echo "      OK: rejected, naming hs_daily_checkins_work_location_check"

echo "[6/6] Round-tripping the rollback..."
echo "  applying rollback_504..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$MIG_DIR/sql/rollback_504_hs_checkin_work_location.sql"

HAS_COL=$(psql "$SCRATCH_URL" -t -A -c "
SELECT count(*) FROM information_schema.columns
WHERE table_name = 'hs_daily_checkins' AND column_name = 'work_location';
")
[ "$(echo "$HAS_COL" | tr -d '[:space:]')" = "0" ] || fail "work_location column still present after rollback"
echo "      OK: work_location column is gone"

IS_NULLABLE=$(psql "$SCRATCH_URL" -t -A -c "
SELECT is_nullable FROM information_schema.columns
WHERE table_name = 'hs_daily_checkins' AND column_name = 'project_id';
")
[ "$(echo "$IS_NULLABLE" | tr -d '[:space:]')" = "NO" ] || fail "project_id is not NOT NULL after rollback (got: $IS_NULLABLE)"
echo "      OK: project_id is NOT NULL again"

echo "  confirming the rollback deleted the office row (it cannot satisfy the restored NOT NULL)..."
GONE=$(psql "$SCRATCH_URL" -t -A -c "SELECT count(*) FROM hs_daily_checkins WHERE worker_name = 'Office Worker';")
[ "$(echo "$GONE" | tr -d '[:space:]')" = "0" ] || fail "office row survived the rollback — should have been deleted"
echo "      OK: office row deleted by rollback, as designed"

echo "  re-applying 504..."
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -q -f "$MIG_DIR/sql/504_hs_checkin_work_location.sql"

WL2=$(psql "$SCRATCH_URL" -t -A -c "SELECT work_location FROM hs_daily_checkins WHERE worker_name = 'Pre-existing Worker';")
[ "$(echo "$WL2" | tr -d '[:space:]')" = "site" ] || fail "re-applying 504 did not default the surviving row's work_location to site"
echo "      OK: re-applied cleanly, surviving row's work_location defaulted correctly"

echo ""
echo "ALL ASSERTIONS PASSED."
