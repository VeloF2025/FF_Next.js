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
  fold in Track 2.5 grn-confirm `in_stock` receive verb). Confirm `npx eslint .`
  reports **0** violations of `local/no-direct-serial-status-write` — every
  `stock_serials.status` writer must already route through `promoteSerial`
  (Tracks 2.1–2.7) or be on the rule's allow-list. A non-zero count blocks cutover.
- **T-1 day:** resolve / re-confirm the three open cutover concerns:
  - `project_sprint_e_matrix_gap_issued_scrapped` — `(issued, scrapped)` matrix row.
  - `project_sprint_e_mig_364_trigger_3_race` — mig 364 TRIGGER 3 vs cascade.
  - `project_sprint_e_return_trigger_double_emit` — retained `return` trigger.

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

Apply the deferred historic fix: revert the **8** serials regressed by Pattern B
to `activated` and reconcile the **19** spurious `installed_at_drop` events (see
`project_serial_register_wave2`). Re-run `npm run reconcile:serials` after.

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
