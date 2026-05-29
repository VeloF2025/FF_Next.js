# Sprint E — rollback runbook

Reverses the Sprint E serial lifecycle cutover (migration 387 + Track-5 backfill).
Triggered by the abort criteria in `docs/runbooks/sprint-e-cutover.md`.

> There is **no `--rollback` flag** on `scripts/deploy-local.sh`. Rolling back the
> app means redeploying the previous commit. The pre-cutover SHA MUST be captured
> before T-0 (cutover runbook step 1 writes it to `/tmp/sprint-e-rollback-target`).

All DB commands use the **postgres superuser** (`feedback_prod_migration_db_user`);
connection details in `.claude/credentials.local.md`.

## Steps

### 1. Confirm the rollback target

```bash
cat /tmp/sprint-e-rollback-target   # ROLLBACK_TARGET=<sha>
# If the file is gone: ROLLBACK_TARGET=$(git rev-parse <last-merge-before-cutover>)
source /tmp/sprint-e-rollback-target
```

### 2. Apply the migration rollback (single txn)

```bash
psql "$DATABASE_URL" -1 -f scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql
```

This drops the new validate/emit/holder-validate triggers + their functions,
un-renames `stock_serials.status` (`in_stock → available`), restores the legacy
11-value CHECK, drops the matrix/holder-pair/violations tables, re-creates the
three legacy emit triggers, and deletes the `migrations` row for version 387.

### 3. Drop the cutover marker

```bash
psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS __sprint_e_cutover_gate__;"
```

Re-gates mig 387 so a future re-attempt re-trips the deferral guard.

### 4. Redeploy the pre-cutover commit

`deploy-local.sh` has no rollback flag — point it at the captured SHA via a
temporary worktree:

```bash
source /tmp/sprint-e-rollback-target
git worktree add /tmp/ff-rollback "$ROLLBACK_TARGET"
( cd /tmp/ff-rollback && bash scripts/deploy-local.sh production )
git worktree remove /tmp/ff-rollback
```

### 5. Verify

```bash
npm run reconcile:serials   # legacy reconcile must pass (≤ tolerance)
curl -s -o /dev/null -w '%{http_code}\n' https://app.fibreflow.app   # 200
psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM stock_serials WHERE status='in_stock';"   # → 0 (un-renamed)
```

## §residual-events — known limitation

`rollback_387` reverts schema and the status rename, but **does not delete the
events the backfill inserted** (`backfill_rename` + synthetic `received`). They are
forward-only audit rows. Consequence of a backfill-then-rollback:

- `stock_serials.status` is correctly back to `available`, and the legacy app
  (which does not read `stock_serial_events` for status) behaves normally.
- The `latest_event_matches_status` reconcile check (tolerance 0) **will report
  drift** equal to the number of renamed serials, because each one's latest event
  (`backfill_rename → in_stock`) no longer matches its reverted status.

This is cosmetic audit residue, not a functional regression. If a clean event
table is required after rollback, manually delete the backfill's events:

```sql
-- The backfill tags every event it causes (the trigger-written backfill_rename
-- rows AND the synthetic received gap-fill rows) with source_table set from the
-- ff.event_source_table GUC. Verified: stock_serial_events.source_table varchar(50)
-- (mig 387) ← SOURCE_TABLE 'backfill_2026_05_28' (backfill script).
DELETE FROM stock_serial_events
WHERE source_table = 'backfill_2026_05_28';
```

## Rehearsal

`scripts/rehearse-sprint-e-rollback.sh` proves the above against a throwaway copy
of prod (boots Docker PG15, restores a public-schema dump, applies mig 387 +
backfill `--commit`, applies this rollback, then asserts). Re-run it the week
before cutover and refresh the numbers below.

```
# rehearsal output — 2026-05-29 (against prod snapshot: 36,264 serials / 377 events)
pre_status_dist:  activated|1427  available|34594  installed|243
[PASS] mig-387 functions dropped (validate / emit / holder_validate)
[PASS] mig-387 tables dropped (transitions / holder_pairs / violations / __sprint_e_cutover_gate__)
[PASS] picking_done body restored      # == pre-387 baseline (mig 384)
[PASS] oes_activate body restored      # == pre-387 baseline (mig 365)
[PASS] drop_install body restored      # == pre-387 baseline (mig 386)
[PASS] stock_serials count restored (36264)
[PASS] status distribution restored    # activated 1427 / available 34594 / installed 243
events: 377 -> 36350 (delta 35973)     # backfill audit rows rollback retains by design
reconcile: 5/6 OK; latest_event_matches_status drift=34594 (the residual events — see above)
PASS: rolled back to the exact pre-387 trigger bodies, schema objects, serial count and status distribution.
```

> This rehearsal is what caught the original `rollback_387` defect (it restored
> `picking_done` from mig 366 and `drop_install` from mig 367, silently reverting
> the later non-gated migs 384/386). After pinning the rollback to the latest
> applied bodies, the three "body restored" assertions pass.
