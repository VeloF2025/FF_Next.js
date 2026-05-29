#!/usr/bin/env bash
# scripts/rehearse-sprint-e-rollback.sh
#
# Proves that the Sprint E cutover (migration 387 + Track-5 backfill) is cleanly
# reversible by replaying it against a throwaway copy of the production DB and
# then applying the rollback.
#
# Run the week before cutover (Task 6.4). Record the captured numbers in
# docs/runbooks/sprint-e-rollback.md.
#
# What it asserts (all HARD unless noted):
#   - the 3 mig-387 objects sets (validate/emit/holder triggers + functions +
#     transitions/holder_pairs/violations tables + cutover marker) are GONE
#   - the 3 legacy emit functions' definitions match their pre-387 baseline
#     (compared via pg_get_functiondef in-container, so no pg_dump rendering noise) —
#     this is the check that catches rollback restoring a stale (wrong-migration) body
#   - stock_serials COUNT and status distribution are back to the pre-387 baseline
#   - REPORT (not a gate): stock_serial_events delta + reconcile output (see note)
#
# NOTE on events: rollback_387 un-renames status (in_stock -> available) and drops
# the new schema, but DOES NOT delete the events the backfill inserted
# (backfill_rename + synthetic received) — forward-only audit rows. So a
# backfill-then-rollback leaves residual events, and the `latest_event_matches_status`
# reconcile check (tolerance 0) is EXPECTED to flag them. Reported, not failed —
# the documented rollback limitation (runbook §residual-events).
set -euo pipefail

CONTAINER="ff-sprint-e-rollback-rehearsal"
PG_PORT="${PG_PORT:-5438}"
DUMP_FILE="${DUMP_FILE:-/tmp/fibreflow-prod-dump.sql.gz}"

# All psql goes through this — NEVER eval (SQL contains () which eval mangles).
pg() { PGPASSWORD=rehearsal psql -h localhost -p "$PG_PORT" -U postgres -d fibreflow "$@"; }
# md5 of a function's full definition (empty string if the function is absent).
fn_def() { pg -tA -c "SELECT COALESCE(md5(pg_get_functiondef(oid)::text),'') FROM pg_proc WHERE proname='$1';" 2>/dev/null; }
status_dist() { pg -tA -F'|' -c "SELECT status, count(*) FROM stock_serials GROUP BY status ORDER BY status;"; }

if [ ! -f "$DUMP_FILE" ]; then
  cat <<EOF
ERROR: dump not found at $DUMP_FILE

Take a fresh public-schema dump of the shared Supabase DB first (read-only). We
keep the full public SCHEMA but skip DATA for the bulky audit/log/photo tables
that are NOT in the serial dependency graph, shrinking ~3.7GB -> ~50MB.
Extensions are pre-created in the container below, so -n extensions is not dumped.

  EXCL="dr_activity_log email_outbox construction_qa_reviews system_health_logs \\
        dr_photo_unified_reviews offline_devices chat_knowledge construction_qa_photos \\
        sharepoint_1map_ins pole_qa_photos exfo_test_results maintenance_qcontact_sync_log \\
        sharepoint_hld_home"
  X=""; for t in \$EXCL; do X="\$X --exclude-table-data=public.\$t"; done
  PGPASSWORD=... pg_dump -h 100.96.203.105 -p 5437 -U postgres -d fibreflow \\
    --no-owner --no-privileges -n public \$X | gzip > $DUMP_FILE
EOF
  exit 1
fi

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "1. Boot throwaway Postgres 15 on :$PG_PORT"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=fibreflow \
  -p "127.0.0.1:${PG_PORT}:5432" postgres:15 >/dev/null   # loopback only — never expose the throwaway DB on velo's Tailscale iface
for _ in $(seq 1 30); do
  pg -c 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
pg -c 'SELECT 1' >/dev/null 2>&1 || { echo "ERROR: Postgres container did not become ready within 30s"; docker logs "$CONTAINER" 2>&1 | tail -20; exit 1; }

echo "2. Pre-create extensions the dump's public defaults need (search_path='' in dump)"
# The dump references public.uuid_generate_v4() etc.; create them in public so the
# dependent CREATE TABLEs succeed. ON_ERROR_STOP off on the restore swallows the
# remaining Supabase role/ACL noise.
pg -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
pg -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
pg -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'

echo "   restore production dump..."
gunzip -c "$DUMP_FILE" | pg -v ON_ERROR_STOP=0 >/tmp/rehearsal-restore.log 2>&1 || true

# Guard: the tables under test must have restored, or the dump scope is wrong.
SER0=$(pg -tA -c "SELECT count(*) FROM stock_serials;" 2>/dev/null || echo "ERR")
if [ "$SER0" = "ERR" ] || ! [ "${SER0:-0}" -gt 0 ] 2>/dev/null; then
  echo "FAIL: stock_serials did not restore (count=$SER0). Restore errors:"
  grep '^ERROR' /tmp/rehearsal-restore.log | sort | uniq -c | sort -rn | head -20
  exit 1
fi

echo "3. Snapshot pre-mig-387 baseline"
PRE_PICK=$(fn_def trg_emit_serial_event_on_picking_done)
PRE_OES=$(fn_def trg_emit_serial_event_on_oes_activate)
PRE_DROP=$(fn_def trg_emit_serial_event_on_drop_install)
PRE_EVENTS=$(pg -tA -c "SELECT count(*) FROM stock_serial_events;")
PRE_SERIALS=$(pg -tA -c "SELECT count(*) FROM stock_serials;")
PRE_DIST=$(status_dist)
echo "  pre_events=$PRE_EVENTS pre_serials=$PRE_SERIALS"
echo "  pre_status_dist:"; echo "$PRE_DIST" | sed 's/^/    /'

echo "4. Create cutover marker + apply mig 387 + backfill --commit"
pg -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE __sprint_e_cutover_gate__ (created_at timestamptz NOT NULL DEFAULT NOW());"
pg -v ON_ERROR_STOP=1 -1 -f scripts/migrations/sql/387_serial_lifecycle_state_machine.sql
DATABASE_URL="postgresql://postgres:rehearsal@localhost:$PG_PORT/fibreflow" \
  npx tsx scripts/backfill-serial-lifecycle-status.ts --commit

echo "5. Apply rollback_387 + drop marker"
pg -v ON_ERROR_STOP=1 -1 -f scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql
pg -v ON_ERROR_STOP=1 -c "DROP TABLE IF EXISTS __sprint_e_cutover_gate__;"

echo "6. Snapshot post-rollback + assert"
POST_PICK=$(fn_def trg_emit_serial_event_on_picking_done)
POST_OES=$(fn_def trg_emit_serial_event_on_oes_activate)
POST_DROP=$(fn_def trg_emit_serial_event_on_drop_install)
POST_EVENTS=$(pg -tA -c "SELECT count(*) FROM stock_serial_events;")
POST_SERIALS=$(pg -tA -c "SELECT count(*) FROM stock_serials;")
POST_DIST=$(status_dist)
echo "  post_events=$POST_EVENTS post_serials=$POST_SERIALS"
echo "  post_status_dist:"; echo "$POST_DIST" | sed 's/^/    /'

fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  [PASS] $1"; else echo "  [FAIL] $1 ($2 != $3)"; fail=1; fi
}

# 6a. mig-387 objects must be gone.
for obj in trg_stock_serial_status_validate trg_stock_serial_status_emit trg_stock_serial_holder_validate; do
  chk "mig-387 function $obj dropped" "" "$(pg -tA -c "SELECT COALESCE(proname::text,'') FROM pg_proc WHERE proname='$obj';")"
done
for tbl in stock_serial_status_transitions stock_serial_status_holder_pairs stock_serial_lifecycle_violations __sprint_e_cutover_gate__; do
  chk "mig-387 table $tbl dropped" "" "$(pg -tA -c "SELECT COALESCE(to_regclass('public.$tbl')::text,'') ;")"
done

# 6b. legacy emit functions restored to their pre-387 (latest-applied) bodies.
chk "picking_done body restored" "$PRE_PICK" "$POST_PICK"
chk "oes_activate body restored" "$PRE_OES"  "$POST_OES"
chk "drop_install body restored" "$PRE_DROP" "$POST_DROP"

# 6c. data: count + status distribution back to baseline.
chk "stock_serials count restored" "$PRE_SERIALS" "$POST_SERIALS"
chk "status distribution restored" "$PRE_DIST" "$POST_DIST"

echo "7. REPORT (not a hard gate): residual backfill events + reconcile"
echo "  events: $PRE_EVENTS -> $POST_EVENTS (delta $((POST_EVENTS - PRE_EVENTS)) — backfill audit rows rollback retains by design)"
DATABASE_URL="postgresql://postgres:rehearsal@localhost:$PG_PORT/fibreflow" \
  npx tsx scripts/reconcile-serials.ts || \
  echo "  (reconcile non-zero — expect latest_event_matches_status to flag the residual events; see runbook §residual-events)"

if [ "$fail" -eq 0 ]; then
  echo "PASS: mig 387 + backfill rolled back to the exact pre-387 trigger bodies, schema objects, serial count and status distribution."
else
  echo "FAIL: a hard assertion failed (see above)."
  exit 1
fi
