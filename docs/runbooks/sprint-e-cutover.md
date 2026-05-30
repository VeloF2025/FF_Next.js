# Sprint E — Serial lifecycle state-machine cutover runbook

Authoritative sequence-of-operations for activating the Sprint E serial
lifecycle state machine in **production**. Track 7 executes this runbook.

> **Production deploy rules apply** (CLAUDE.md): after-hours only (outside
> 08:00–17:00 SAST Mon–Fri), Hein's explicit approval, always via
> `bash scripts/deploy-local.sh production` — never a manual pull/build/restart.

## What "cutover" flips on

Until cutover, migration 387 is **gated**: `run-pending-migrations.sh` treats it
as *deferred* (not failed) because the marker table `__sprint_e_cutover_gate__`
does not exist (see `feedback_migration_runner_blocked_by_387_gate`). Cutover:

1. Creates `__sprint_e_cutover_gate__`.
2. Applies mig 387 — installs the transition matrix, the
   validate/emit/holder-validate triggers, the holder-pair table, and (appended
   at Track 2.7) DROPs the three legacy emit triggers.
3. Runs the Track-5 backfill (`available → in_stock` rename + genesis gap-fill).
4. Deploys the app commit that has the Track-3 ESLint rule
   `local/no-direct-serial-status-write` flipped to `"error"`.

## Pre-cutover preparation

- **T-7 days:** complete the A/B/C/D prod app promotion (see
  `project_olt_lookandfeel_rollout`) and let it soak 24h.
- **T-7 days:** run the rollback rehearsal (`scripts/rehearse-sprint-e-rollback.sh`)
  against a fresh prod dump; record its output in `docs/runbooks/sprint-e-rollback.md`.
- **T-1 day:** land the cutover code commit (Track-3 ESLint rule → `"error"`;
  fold in Track 2.5 grn-confirm `in_stock` receive verb). Then run the readiness
  gate (this is the check mig 387's gate message names):
  ```bash
  npx tsx scripts/verify-no-direct-status-writes.ts   # must exit 0
  ```
  It forces `local/no-direct-serial-status-write` to `"error"` over `src/` +
  `pages/` regardless of its configured severity (a plain `npx eslint .` cannot
  catch anything while the rule still ships `"off"`). **Exit 0 is required before
  creating `__sprint_e_cutover_gate__`** — every `stock_serials.status`/`holder_id`
  writer must route through `promoteSerial` (Tracks 2.1–2.7) or be on the rule's
  allow-list. A non-zero count blocks cutover.
  > RESOLVED (2026-05-30, Track 7 cutover commit): the gate now exits **0**. All
  > former writers were routed through `promoteSerial` or retired — `serialService`
  > `updateSerialStatus`/`markSerialInstalled` (dead, deleted); `serialStateMachine`
  > + `serials/transition` (dead vocab, deleted); `movementReversalService`
  > (`promoteSerial` bypass); `fault-reports/[faultId]` (`promoteSerial`,
  > faulty→in_stock/scrapped); `returns/[returnId]/accept` restock (`promoteSerial`
  > in_stock). The ESLint rule is flipped to `"error"` in the same commit.
- **T-1 day:** the three former cutover concerns are RESOLVED in the Track 7 commit:
  - `(issued, scrapped)` — closed: return creation flips issued→returned, then
    disposition does returned→scrapped (both matrixed). matrix row not needed.
  - mig 364 TRIGGER 3 race — already handled: the live emitter is
    `emit_serial_event_on_oes_activate`, dropped by mig 387's Track 2.7 block.
  - return-trigger double-emit / FF001 — closed: the two return-creation triggers
    (`emit_serial_event_on_return{,_line_insert}`) are dropped by mig 387 and
    creation now routes through `promoteSerial('returned')` (single event).
    New matrix rows: `issued→returned`, `returned→faulty`, `faulty→in_stock`.

## T-0 cutover window (ordered)

All DB commands use the **postgres superuser** (prod migrations require it — see
`feedback_prod_migration_db_user`); connection details in
`.claude/credentials.local.md`. Run from the production deploy dir.

### 1. Pre-flight (≈15 min)

```bash
# Capture the rollback target BEFORE the cutover deploy. Use the deploy dir's
# currently checked-out commit (the pre-cutover build) — more reliable than
# origin/master~1, which assumes no intervening merges. Run from the deploy dir.
git fetch origin master --quiet
echo "ROLLBACK_TARGET=$(git rev-parse HEAD)" > /tmp/sprint-e-rollback-target
cat /tmp/sprint-e-rollback-target   # record this SHA in the incident channel

# Baseline reconcile — must be clean (or only the known pre-existing drift).
npm run reconcile:serials

# Confirm the gate is NOT yet present.
psql "$DATABASE_URL" -c "SELECT to_regclass('public.__sprint_e_cutover_gate__');"  # → NULL

# Dry-run the backfill and eyeball the counts (expect ~34.6k rename / ~1.4k gap-fill).
npx tsx scripts/backfill-serial-lifecycle-status.ts
```

### 2. Create the gate + apply migration 387 (single txn)

```bash
psql "$DATABASE_URL" -c \
  "CREATE TABLE __sprint_e_cutover_gate__ (created_at timestamptz NOT NULL DEFAULT NOW());"

psql "$DATABASE_URL" -1 -f scripts/migrations/sql/387_serial_lifecycle_state_machine.sql
```

Mig 387 records `version='387'` in the `migrations` table on success, so the
deploy's migration runner (step 4) will see it applied and skip it.

### 3. Run the backfill (`--commit`)

```bash
npx tsx scripts/backfill-serial-lifecycle-status.ts --commit
```

The AFTER-UPDATE emit trigger writes one `backfill_rename` event per renamed row;
the script gap-fills a synthetic `received` genesis event for any serial still
event-less afterwards. No `ff.bypass_validation` (the rename is a matrixed
transition and every `available` serial has `holder_id IS NULL`).

> **Expected non-fatal exit (2026-05-30 rehearsal).** The script's *pre-flight*
> guards (retired status present, or an `available` serial carrying a `holder_id`)
> abort BEFORE any write — those are the real abort triggers. Its *post-verify*
> (`remaining available=0`, `zero-event=0`, `latest_event_matches_status drift=0`)
> runs AFTER the rename has committed. If only `latest_event_matches_status` is
> non-zero, the rename succeeded and the drift is the pre-existing **Pattern B**
> historic data (serials `status=activated` whose latest event is `installed_at_drop`
> from the live OES cascade — 3 such rows on 2026-05-29, and growing nightly).
> This is NOT an abort trigger: proceed to step 6 historic cleanup, which clears
> it. Characterise the exact set live at cutover (do not assume the old "8").

### 4. Deploy the app

```bash
bash scripts/deploy-local.sh production
```

This applies any remaining pending migrations — including the gated **mig 392**
(Track 4.5: `CREATE OR REPLACE` of `trg_emit_serial_event_on_return_disposition`
that removes its residual `contractor_stock_accountability` counter block, then
`DROP TABLE contractor_stock_accountability`), whose `__sprint_e_cutover_gate__` guard is now
satisfied and which the runner applies in numeric order after 387 (387 already
recorded → skipped). Then it runs the lint gate, stops the service, builds, swaps,
and health-checks.

### 5. Post-deploy verification

```bash
npm run reconcile:serials                                  # all checks ≤ tolerance
curl -s -o /dev/null -w '%{http_code}\n' https://app.fibreflow.app   # 200
psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM stock_serials WHERE status='available';"     # → 0 (all renamed)
```

Confirm the Bugsink FF001/FF002 rule (`docs/runbooks/sprint-e-bugsink-alerts.md`)
is live and quiet.

### 6. Historic cleanup

Apply the deferred historic fix for **Pattern B** drift (serials `status=activated`
whose latest event is `installed_at_drop` — the OES cascade emits the install event
after activation). **Characterise the live set first — do NOT assume the old "8".**
The cascade runs nightly, so the count grows: the 2026-05-30 rehearsal saw 3 fresh
rows (`ALCLB48E004C`, `ALCLB48F2F05`, `ALCLB480E59D`, all 2026-05-29 20:11) on top
of the originally documented 8.

```sql
-- The live Pattern B set at cutover time:
WITH latest AS (
  SELECT DISTINCT ON (serial_id) serial_id, to_state, event_type
  FROM stock_serial_events ORDER BY serial_id, occurred_at DESC, id DESC)
SELECT ss.id, ss.serial_number, ss.status, l.to_state, l.event_type
FROM stock_serials ss JOIN latest l ON l.serial_id = ss.id
WHERE l.to_state IS DISTINCT FROM ss.status
  AND NOT (l.to_state = 'in_stock' AND ss.status = 'available');
```

Reconcile each (revert the serial or delete the spurious `installed_at_drop` event,
per `project_serial_register_wave2`). Re-run `npm run reconcile:serials` after —
`latest_event_matches_status` must reach tolerance.

### 7. Release the change flag / close the window.

## Monitoring taper

Adjust the `scripts/cron-serial-reconcile.sh` crontab frequency (velo cron is
SAST):

| Window | Crontab |
|--------|---------|
| T-0 .. T+48h | `*/10 * * * *` |
| T+48h .. T+1week | `0 * * * *` |
| T+1week onward | `0 6 * * *` |

- **T+4h:** end active hands-on monitoring (alerts remain on).

## Abort criteria → rollback

Trigger `docs/runbooks/sprint-e-rollback.md` if, during or shortly after the
window, any of:

- The app health check fails and a rebuild does not recover it.
- `npm run reconcile:serials` shows **new** drift above tolerance that does not
  resolve, OR the FF001/FF002 Bugsink rule fires repeatedly (lifecycle
  violations cascading).
- The backfill `--commit` aborts on a pre-flight guard (retired status present,
  or an `available` serial carrying a `holder_id`) — do **not** force past it.
