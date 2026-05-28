# Sprint E — Serial Lifecycle State Machine — Design

**Date:** 2026-05-28
**Status:** Approved design (brainstorm + grill-me complete). Next: `writing-plans`.
**Owner:** Hein
**Module:** Procurement / Field Stock
**Branch / worktree:** `docs/stock-mgmt-rebuild-spec` @ `/home/hein/Workspace/FF_Next.js-stock-mgmt-spec` (off `origin/master` `92ae0cdc3`)
**Roadmap parent:** `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md` — this is the **fifth sub-project** after B (Locations v2, #1772), A (Ledger consolidation, #1777), C (Holder registry, #1780), D (Pure custody, #1786).
**Depends on:** B + A + C + D — all shipped to dev 2026-05-25/26. Hard prerequisite: A/B/C/D production app promotion before E's cutover.
**Triggered by:** `latest_event_matches_status` reconcile drift, 2026-05-28 (27 ONT serials drifted between `stock_serials.status` and `stock_serial_events`; PR #1805 fixes the immediate trigger and cascade bugs but does not address the structural gap).

---

## Grill-me decisions (2026-05-28)

Five high-leverage decisions resolved during the grill-me gate; documented inline below
where they apply. Captured here for searchability:

1. **`pre_provision` is an overlay flag, not a status enum value.** The 8-state vocabulary
   in L1 below excludes `pre_provision`; existing `pp_flagged` + `pp_resolution_status`
   columns (mig 312) stay.
2. **A/B/C/D production app promotion is a hard prerequisite.** Shared Supabase DB means
   the validate-trigger applies to both apps the moment mig 387 lands; prod app must be on
   post-D code first.
3. **Sprint E ships fast, accepting elevated risk.** No warn-only stage, no separate test
   DB, no shadow run. Current model is already broken; revert is the safety net.
4. **Rollback rehearsal commit + runbook in DoD.** Rehearsed against a `pg_dump`-restored
   Docker DB the week before cutover; runbook at `docs/runbooks/sprint-e-rollback.md`.
5. **Three-layer detection.** Bugsink alerts on `lifecycle_violation` SQLSTATE + cron'd
   reconcile every 10 min for 48h + active monitoring for first 4 hours post-cutover.

---

## Deviations from spec applied during implementation

Mig 387 deviates from the spec's L3 model: `holder_id` is for **person-custody only**
(matches Sprint D shipped reality — mig 383 `stock_holders_type_chk` restricts
`holder_type` to `{staff, contractor, external_person}`), not for warehouse/project/vendor.

The spec table in "State vocabulary" lists `warehouse`, `project`, and `vendor` as custody
holders. **These are wrong.** Sprint D made a deliberate architectural choice: holder = person,
location = `stock_locations` + `stock_quants`. The two are kept separate so Odoo warehouse
reconciliation is not corrupted by personal van-stock data.

**The corrected three-axes mental model** (authoritative; use this, not the L3 table above):

| Axis | Column | Tracks | Allowed values |
|---|---|---|---|
| Lifecycle | `stock_serials.status` | what phase of life | the 8-state vocab |
| Person-custody | `stock_serials.holder_id` → `stock_holders` | who's CARRYING the unit (only for `issued`/`faulty`-during-pickup) | NULL or staff/contractor person |
| Location | `stock_serials.current_location_id` → `stock_locations` | where the unit is physically | warehouses, sites, etc. |

For `in_stock`/`allocated_to_project`/`returned`, the unit is at a warehouse location —
tracked via `stock_locations` + `stock_quants`, not via `holder_id`. `holder_id` is NULL for
those statuses.

The `stock_serial_status_holder_pairs` seed data reflects this correction: 11 rows with
NULL or `{staff, contractor}` holder_types only.

---

## Purpose

Make `stock_serials.status` the single, validated, trigger-emitted source of truth for the
ONT/Gizzu lifecycle — closing the only foundation gap that Sprints B/A/C/D left open. Today the
status field is written from ~12 places, has no transition validation, and drifts from its own
event log within days (the bug PR #1805 patches one of several drift sources). This spec
generalises the trigger pattern from migrations 365/367 into a single generic mechanism and
forces all status writes through a typed helper that composes the shipped Sprint D custody
postings. Pre-provision tracking stays as the existing overlay (`pp_flagged` +
`pp_resolution_status`).

Plus: clear the deferred fast-follows from Sprint D so the custody work is fully consolidated
under one operating model.

---

## Background

### Today's gap (verified against live shared DB + `origin/master`, 2026-05-28)

- **`stock_serials.status` CHECK constraint allows 11 values; only 3 are ever written.**
  `available` = 34,609, `installed` = 242, `activated` = 1,413, total 36,264. The other 8
  (`reserved`, `allocated_to_project`, `in_transit`, `issued`, `faulty`, `in_repair`,
  `returned`, `scrapped`) are dead enum entries.
- **No `pre_provision` state exists.** The workflow Hein walked through has an anomaly path
  (`installed → pre_provision → activated`, plus a rarer post-activate ping-pong
  `activated → pre_provision → activated`). Today it has nowhere to live in
  `stock_serials.status`; pre-provision rows hide in `oes_pp_data.resolved_to='pp'` and the
  serial's status stays `installed` or `activated`.
- **`stock_serial_events` covers ~1% of the population.** Only 356 events across 36,264
  serials (253 `installed_at_drop`, 54 `activated`, 49 `wa_photo_sighting`). The supplier →
  warehouse → project → tech transitions never emit events because no code path emits them.
- **~10 code paths write `stock_serials.status` directly with no shared discipline.**
  `consumptionService.recordConsumption` (SQL_INSTALL_SERIAL), `cascadePpResolution`,
  `scanSerialService`, `serialForceCorrectService`, the picking-process txn, the return-accept
  txn, the OES trigger (mig 365), the drops install trigger (mig 367), and several scripts.
  Two of them are documented drift sources (Pattern A and B from the 2026-05-28 triage; see
  PR #1805 for the immediate fix).
- **Transition validity is unenforced.** Pattern B regressed `activated → installed` without
  any constraint blocking it. `feedback_ont_lifecycle_one_way.md` documents the one-way rule
  but it lives only in feedback memory, not in the schema.

### What Sprints B/A/C/D shipped (foundation to compose with, not replace)

- `stock_quants` (Sprint A) = warehouse-grain inventory balance, Odoo-seeded (495 rows / 1.37M
  units / 12 warehouses). **Custody never lands here** — Sprint D explicitly kept the two
  separate so Odoo warehouse reconciliation stays clean.
- `stock_holders` (Sprint C) = identity-only with typed FKs (`staff_id` or `contractor_id`,
  mutually exclusive per `holder_type`). 5 staff holders backfilled live.
- `stock_custody` + `stock_accountability` (Sprint D) = holder-grain custody balance + live
  view `v_holder_accountability`. `contractor_stock_accountability` retained dormant behind
  `v_contractor_accountability` shim.
- `field_stock_movements` (Sprint A balance ledger / Sprint D extended) = double-entry, UUID
  FKs, `from_holder_id` / `to_holder_id` with per-side exactly-one CHECK. The single ledger
  pickings / consumption / return all post through.
- Mig 366 picking-done trigger emits `stock_serial_events` for picking-completion and updates
  the serial status to `issued` — but only for that one trigger source.

The shipped infrastructure handles **where a serial is** (location via `stock_quants`, holder
via `stock_custody`). It does **not** handle **what phase of life a serial is in** consistently
— that is this spec's scope.

---

## Goals

1. `stock_serials.status` reflects ground truth at all times; drift is structurally impossible.
2. The complete lifecycle Hein described is representable in the schema: supplier → warehouse
   → project → technician → installed → activated. Pre-provision tracking remains the
   existing `pp_flagged`/`pp_resolution_status` overlay (no new status enum value).
3. All status writes flow through one helper (`promoteSerial`) so context, validation, and
   event emission are uniform.
4. Mig 365/367 per-source triggers are retired in favour of one generic trigger.
5. Sprint D's deferred fast-follows (block enforcement, accountability migration, scrap/faulty
   custody-debit decision, off-book guard) ship in the same window.

## Non-goals

1. Re-modelling `stock_quants` or `stock_custody` — those are Sprint A/D and stay.
2. Adding new event tables — `stock_serial_events` is reused; only its emission pattern
   changes.
3. Expanding the model to non-serialised stock (bulk items) — out of scope.
4. UPS / splitter / non-ONT-Gizzu serialised items — same model applies but rolling them in is
   a follow-up; scope here is ONT + Gizzu (the painful surface).
5. Replacing Sprint A's `qty_available` → derived cutover (that's a separate fast-follow
   already named in the A spec).

---

## Architecture

```
L0  Reference data            stock_items, stock_locations, stock_holders, vendors
                              (shipped B/C; unchanged)

L1  Lifecycle state           stock_serials.status + stock_serial_events    ← THIS SPEC
                              Trigger-derived, hard-enforced, 8 states

L2  Inventory positions       stock_quants + field_stock_movements (warehouse grain)
                              (shipped A; unchanged)

L3  Custody                   stock_custody + stock_accountability (holder grain)
                              + holder columns on field_stock_movements
                              (shipped D; this spec composes with it)

L4  Movement verbs            promoteSerial() helper + six TS service functions
                              (receive/allocate/issue/install/activate/return)
                              Each writes L1 (this spec) + L3 (shipped D) in one txn
                              ← THIS SPEC adds the L1-side wiring + helper

L5  Read surfaces             v_holder_accountability (shipped D),
                              v_contractor_accountability (D shim),
                              Wave 2 dashboards
                              Reconcile checks become P1 assertions, not drift detectors
```

Status (L1) and custody (L3) are **independent state machines** on the same `stock_serials`
row. Both are trigger-driven. Cross-validation (`status='in_stock'` requires the holder to be a
warehouse-type, etc.) lives in a single function called by both triggers.

The six L4 verbs are the **only public API** for status writes. ESLint + a `scripts/ci-local.sh`
grep gate enforces the rule.

---

## L1 — Lifecycle state machine

### State vocabulary

Replace today's 11-value enum with these 8 values:

| Status | Meaning | Custody (typical) |
|---|---|---|
| `in_stock` | Physically at a warehouse, available to allocate / issue | `warehouse` holder |
| `allocated_to_project` | Earmarked for a project; physically at warehouse **or** project staging — both allowed (Hein's call: depends on project size) | `warehouse` or `project` holder |
| `issued` | Held by a technician en route to installation | `staff` holder |
| `installed` | Physically installed at a customer drop, not yet OES-activated | NULL (at customer) |
| `activated` | OES has registered the unit on the OLT | NULL |
| `faulty` | Marked for replacement / RMA | `staff` (during pickup), `warehouse` (post-pickup), or `vendor` (RMA in flight) |
| `returned` | Back at warehouse, awaiting disposition (restock or scrap) | `warehouse` |
| `scrapped` | Terminal. Out of inventory. | NULL or `vendor` |

Retired: `reserved` (collapses into `allocated_to_project`), `in_transit` (logistics fact, not
lifecycle), `in_repair` (collapses into `faulty`). `available` is renamed to `in_stock` and
mechanically backfilled.

**Pre-provision is an overlay, not a status.** The existing `stock_serials.pp_flagged`,
`pp_flagged_at`, and `pp_resolution_status` columns (mig 312, live: 1,995 flagged rows) stay.
A serial in PP work has its lifecycle status untouched (`installed` or `activated`) and the
overlay set. The overlay's rich resolution taxonomy (`located_1map`, `located_unified`,
`located_local`, `located_oes`, `not_found`, `pp_flagged`, `activated`) is preserved as-is.
PP transitions emit dedicated `pp_flagged` / `pp_resolved` events on `stock_serial_events`
(triggered by `pp_flagged` column changes), but do not change `stock_serials.status`. Grill-me
decision 2026-05-28.

### Transition matrix (hard-enforced)

Encoded as a static table `stock_serial_status_transitions(from_state, to_state,
event_type)`, populated by migration and read by the validate trigger. Anything not listed
raises. The `(no prior row)` INSERT case is encoded as the sentinel string `'__new__'` in
`from_state` because Postgres forces PK columns to NOT NULL; the trigger functions translate
between `OLD.status IS NULL` (INSERT) and the sentinel value on the way in, and back to NULL
when writing the event row.

| From → To | event_type | Allowed source_table(s) |
|---|---|---|
| `(no row)` → `in_stock` | `received` | `procurement_grns`, `odoo_quant_seed` |
| `(no row)` → `available` | `received` | Transitional row — legacy INSERTs prior to mig 387's backfill rename. Kept so any straggler INSERT before the rename completes does not throw `lifecycle_violation`. Removed by a follow-up migration once the live count of `status='available'` reaches zero. |
| `available` → `in_stock` | `backfill_rename` | Mig 387's backfill (`UPDATE stock_serials SET status='in_stock' WHERE status='available'`). Backfill runs with `ff.bypass_validation=true` set, so the emit-trigger emits `force_corrected` events; the bypass log row in `stock_serial_lifecycle_violations` is the persistent audit trail. Row exists in the matrix so a non-bypass `UPDATE` from any straggler caller is also accepted. |
| `in_stock` → `allocated_to_project` | `allocated` | `projects.allocations` if a dedicated table exists at Track 2.6.1, else the picking-creation step. Allowed source resolved at caller enumeration; row stays in the matrix per open-question §1 decision (keep). |
| `allocated_to_project` → `issued` | `issued_to_tech` | `stock_pickings` (status='done') |
| `in_stock` → `issued` | `issued_to_tech` | `stock_pickings` (when allocation is skipped — small projects) |
| `issued` → `installed` | `installed_at_drop` | `drops`, `stock_consumptions` |
| `installed` → `activated` | `activated` | `oes_pp_data` |
| any non-terminal → `faulty` | `marked_faulty` | `stock_returns`, NOC RMA |
| `installed` / `activated` / `faulty` → `returned` | `returned_to_warehouse` | `stock_returns` |
| `returned` → `in_stock` | `restocked` | `stock_returns` (disposition='restock') |
| `faulty` → `scrapped` | `scrapped` | `stock_returns` (disposition='scrap'), RMA |
| `returned` → `scrapped` | `scrapped` | `stock_returns` (disposition='scrap') |
| any → same | (no-op) | n/a — silently no event |

A `SET LOCAL ff.bypass_validation = 'true'` per-transaction escape hatch lets
`serialForceCorrectService` and documented backfill scripts skip enforcement. The bypass
emits the event with `event_type='force_corrected'` (event still recorded; only validation
suppressed).

### Triggers (3 new, 2 retired)

**New on `stock_serials`:**

1. `trg_stock_serial_status_validate` — `BEFORE INSERT OR UPDATE OF status`. Looks up
   `(OLD.status, NEW.status, current_setting('ff.event_source_table', true))` against the
   transition table. Raises `lifecycle_violation` exception unless transition is allowed or
   bypass GUC is set.
2. `trg_stock_serial_emit_event` — `AFTER INSERT OR UPDATE OF status`. When `OLD.status` is
   distinct from `NEW.status` (or row is new), inserts one `stock_serial_events` row with:
   - `event_type` = looked up from the transition table
   - `from_state` = `OLD.status` (NULL on INSERT; the trigger internally uses the `'__new__'` sentinel for the transition lookup but writes NULL to `stock_serial_events.from_state`)
   - `to_state` = `NEW.status`
   - `source_table` = `current_setting('ff.event_source_table', true)` (NULL if unset)
   - `source_id` = `current_setting('ff.event_source_id', true)::uuid` (NULL if unset)
   - `actor_user_id` = `current_setting('ff.event_actor_user_id', true)::uuid` (NULL if unset)
   - `actor_staff_id` = `current_setting('ff.event_actor_staff_id', true)::uuid` (NULL if unset)
   - `payload` = `current_setting('ff.event_payload', true)::jsonb` (default `'{}'`)
   - `occurred_at` = `COALESCE(current_setting('ff.event_occurred_at', true)::timestamptz, NOW())`
   Uses the existing `uq_sse_dedupe` partial unique index for idempotency.
3. `trg_stock_serial_holder_validate` — `BEFORE INSERT OR UPDATE OF status, holder_id`.
   Cross-validates the (status, holder_type) pair against an allowed-pairs table. Raises
   `holder_mismatch` exception unless bypass GUC is set.

**Retired (replaced by 1 + 2):**

- `trg_emit_serial_event_on_drop_install` (mig 367) — drops-side install emission. Generic
  trigger covers it.
- `trg_emit_serial_event_on_oes_activate` (mig 365) — OES-side activation emission. Generic
  trigger covers it.
- `trg_emit_serial_event_on_picking_done` (mig 366) — picking-done emission and status set.
  Picking-process txn now goes through `promoteSerial`; the trigger's contractor-counter side
  effect was already removed in Sprint D, so the whole trigger retires.
- The two per-source triggers' status-update SQL is moved into the corresponding L4 verb (see
  next section).

### Context propagation via per-txn GUCs

Writers set session variables before the UPDATE so the trigger can read them. Pattern:

```sql
SET LOCAL ff.event_source_table = 'stock_pickings';
SET LOCAL ff.event_source_id    = '<picking-uuid>';
SET LOCAL ff.event_actor_staff_id = '<actor-uuid>';
SET LOCAL ff.event_payload      = '{"drop_number":"DR123"}'::text;
UPDATE stock_serials SET status='issued', holder_id=$tech WHERE id=$serial;
```

All five names live under the `ff.` prefix to keep the GUC namespace tidy. A documented
constant in `src/lib/db/serialEventContext.ts` exposes them as TypeScript constants and
provides a `withSerialEventContext(txn, ctx, fn)` helper that issues the `SET LOCAL`s
automatically.

### Pre-install events

For the `(no row) → in_stock` transition (newly-received serial), the emit trigger fires on
INSERT. The validate trigger looks up `from_state = '__new__'` (the sentinel for the
"no prior state" case — see Transition matrix above). No second trigger needed.

---

## L4 — Movement verbs (the public write API)

Six TS services. Each wraps a `pg.Pool` `transaction()`. Each calls `promoteSerial` for the
L1-side write and the existing shipped helpers (`postIssueToHolderWith`,
`postConsumeFromHolderWith`, `postReturnFromHolderWith`, `postGrnReceiptLines`) for the L3+L2
side. Atomic.

### `promoteSerial(txn, serialId, toStatus, context)`

Signature (sketch):

```typescript
async function promoteSerial(
  txn: PgTxn,
  serialId: string,
  toStatus: SerialStatus,
  context: {
    sourceTable: string;
    sourceId: string;
    actorStaffId?: string | null;
    actorUserId?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  }
): Promise<void>;
```

The helper issues the `SET LOCAL ff.*` statements then runs the UPDATE. If the trigger raises
`lifecycle_violation` or `holder_mismatch`, the helper re-throws with a typed error class
(`LifecycleViolationError`, `HolderMismatchError`) that callers can catch for user-friendly
messages.

### The six verbs

| Verb | Service file | L1 (status) | L3 (custody) | L2 (quants) |
|---|---|---|---|---|
| `receive` | `procurement/receiveGrn.ts` | `(null) → in_stock` | `null → warehouse` (Sprint A shipped) | +qty (Sprint A shipped) |
| `allocate` | `procurement/allocateToProject.ts` | `in_stock → allocated_to_project` | optional `warehouse → project` | optional location transfer |
| `issue` | `field-stock/issueToTech.ts` (PWA) | `allocated_to_project → issued` or `in_stock → issued` | `warehouse → staff` (Sprint D shipped via `postIssueToHolderWith`) | move qty |
| `install` | `consumption/recordInstall.ts` | `issued → installed` | `staff → null` (Sprint D shipped via `postConsumeFromHolderWith`) | consume qty |
| `activate` | `oes/applyActivation.ts` (nightly cron) | `installed → activated` | unchanged (null) | none |
| `flagPp` / `resolvePp` | `oes/applyPpFlag.ts` (cron + manual) | unchanged (pp_flagged column toggles) | unchanged | none |
| `return` | `field-stock/returnToWarehouse.ts` | varies → `returned` then `→ in_stock` or `→ scrapped` | `staff → warehouse` (Sprint D shipped via `postReturnFromHolderWith`) | +qty back |

### Discipline gates

- **ESLint rule** `no-direct-serial-status-write` in `eslint-config-fibreflow/`: flags any
  UPDATE on `stock_serials.status` or `stock_serials.holder_id` outside the six verb files
  and `serialForceCorrectService` (the documented bypass-using exception).
- **`scripts/ci-local.sh` grep gate** for the literal patterns `UPDATE stock_serials SET
  status`, `SET status = ` near `stock_serials`, similar for `holder_id`. Fails CI on
  unexpected matches.
- Both gates are **part of this spec's deliverables**, not follow-ups.

---

## Sprint D fast-follows folded in

Per the D design's deferred list, this spec also delivers:

1. **Issue-time block enforcement (SOP-4.4)** — `pickings/[pickingId]/process.ts` checks
   `v_holder_accountability.is_blocked` for the destination holder and refuses to mark the
   picking `done` when blocked. Error surfaces in the PWA UI.
2. **Uniform role-gate on block/unblock** — the holder-route (`accountability/holders/block`)
   and contractor-route (`accountability/contractors/block`) gates harmonised: same RBAC
   permission, same audit fields.
3. **Consumption-no-holder off-book guard** — `consumptionService.recordConsumption` refuses
   to record a consumption when `holderId IS NULL` for a serialised item (today it logs a
   warning and proceeds — that lets "off-book" stock leave inventory). Bulk items unaffected.
4. **Scrap / faulty custody-debit decision** — spec proposes **optimistic** (custody moves on
   physical return, not on status change). Final confirmation in implementation plan.
5. **`contractor_stock_accountability` consumers migrated** off the shim:
   `dashboard.ts`, `dashboardV2Service.ts`, `reconciliationService.ts`,
   `DailyReconciliationDashboard.tsx`, and the `/contractor` + `/kpi` skill docs all read
   `v_holder_accountability` (with the rollup shim retained for one more sprint).
6. **Drop `contractor_stock_accountability`** at the end of Sprint E once consumers are
   migrated.

These are explicitly part of the cutover, not after — coordination cost folded in.

---

## Big-bang rollout

### Hard prerequisite — A/B/C/D prod app promotion

The shared Supabase DB means migration 387's validate-trigger fires for **both** apps the
moment it lands. The prod app must be running post-Sprint-D code before Sprint E ships, or
its legacy direct-status writes break. **Before Sprint E's cutover window:**

1. `bash scripts/deploy-local.sh production` lands the post-D commit on
   `fibreflow-production.service` after-hours (separately approved by Hein per CLAUDE.md
   production deploy rule).
2. ~24h of post-promotion soak time on prod to confirm nothing regresses.
3. Only then schedule the Sprint E cutover window.

Grill-me decision 2026-05-28: this prerequisite is non-negotiable.

### Accepted-risk note

Sprint E ships **without** a warn-only trigger stage, **without** a separate test DB, and
**without** a 1-week shadow run. Grill-me decision 2026-05-28: the current model is already
broken (drift bugs, no pre_provision semantics, undisciplined writers), so the risk floor is
"today's pain" and the risk ceiling is "revert to today's pain". Speed over maximum safety,
**explicitly accepted** by Hein. Detection + revert is the safety net (see "Detection &
rollback" below).

### Cutover window

Off-hours, one weekend (target Friday 22:00 SAST start, complete by Sunday 22:00 — full
weekend for verification + rollback if needed). **Production deploy requires explicit Hein
approval per CLAUDE.md.**

Sequence inside the window:

1. **Pre-flight** (15 min, app paused for stock writes — set a maintenance flag in the
   `/my/stores` PWA + procurement screens):
   - Apply migration **387** (next available; verify with `SELECT MAX(version) FROM
     migrations` and `gh pr list --search 'migration in:title'` immediately before opening):
     - Widen CHECK on `stock_serials.status` to the 8-value vocabulary
     - Add `stock_serial_status_transitions` lookup table + seed rows
     - Add `stock_serial_status_holder_pairs` cross-validation table + seed rows
     - Install three new triggers (validate, emit, holder-validate)
     - Drop mig-365 and mig-367 triggers (mig-366 retires whole trigger)
     - Drop the orphaned per-source trigger functions
2. **Backfill** (~5 min for 36k rows):
   - `available → in_stock` (mechanical rename)
   - `pp_flagged` column untouched (overlay semantics preserved — see L1 vocabulary section)
   - Emit one synthetic `stock_serial_events` row per serial with
     `source_table='backfill_2026-05-XX'` capturing the migrated `to_state` (so the audit
     trail is non-empty from day one).
3. **App deploy**: swap to the new commit that contains:
   - All six L4 verb services rewritten on `promoteSerial`
   - Existing callers (`consumptionService`, `cascadePpResolution`, `scanSerialService`,
     `pickings/process`, `returns/accept`, OES sync handler, drops sync handler) routed
     through the verbs
   - ESLint rule + grep gate active
   - Sprint D fast-follows (#1–5) wired
4. **Post-deploy verification** (must all pass to release the maintenance flag):
   - The L5 reconcile invariant returns 0 across all six checks
   - All six verbs invoked once each with synthetic data: status + custody + quants written
     correctly, events emitted, idempotent on second invocation
   - `v_holder_accountability` agrees with `v_contractor_accountability` rollup
   - Smoke-test the field-stock PWA end-to-end (login → issue → return)
5. **Release flag** at the end of the window; resume normal operations.

### Backfill specifics

| Source signal | New status |
|---|---|
| `status='available'` | → `in_stock` |
| `status='installed'` | → `installed` (unchanged; `pp_flagged` overlay preserved verbatim) |
| `status='activated'` | → `activated` (unchanged; `pp_flagged` overlay preserved verbatim) |
| `status` in `{reserved, in_transit, in_repair}` | re-mapped per audit at backfill-prep time (these are unused today; expected zero rows; abort backfill if any found) |

`pp_flagged`, `pp_flagged_at`, and `pp_resolution_status` columns are untouched by the
backfill — the existing 1,995 flagged rows + rich resolution taxonomy carry through unchanged.

### Detection & rollback (the safety net)

With no warn-only stage and no separate test DB, **detection + revert is the only safety
net**. Three layers, sequenced by latency:

1. **Bugsink alerts** — validate-trigger raises typed exceptions (`lifecycle_violation`,
   `holder_mismatch`); the existing API error handler reports them with
   `tags.event_type=lifecycle_violation` and `tags.sqlstate`. Sprint E adds a Bugsink alert
   rule keyed on those tags → paging channel within ~1 min of first occurrence.
2. **Cron'd reconcile** — `scripts/cron-serial-reconcile.sh` runs the L5 invariants every
   **10 min for first 48h post-cutover**, then hourly for 1 week, then daily. Any non-zero
   result is a P1 page. Cron writes to `/var/log/serial-reconcile.log` on velo (SAST per
   [[feedback_velo_cron_local_time]]).
3. **Active monitoring** — for the first 4 hours post-cutover, the engineer driving the
   deploy keeps `tail -f` on prod app logs + periodic `psql` query against
   `stock_serial_lifecycle_violations` (added by mig 387 as a side table for any
   `RAISE NOTICE` calls during bypass operations).

**Revert trigger** — any of:
(a) reconcile non-zero, (b) >5 `lifecycle_violation` exceptions in first hour, (c)
field-stock PWA end-to-end smoke fails, (d) observable data drift.

**Revert path** (rehearsed before cutover):
- Run `scripts/migrations/sql/rollback_387_serial_lifecycle_state_machine.sql` in a single
  transaction: drops the three new triggers, re-installs mig-365/366/367 verbatim, restores
  CHECK constraint to the 11-value set (additive, lossless), `UPDATE stock_serials SET
  status='available' WHERE status='in_stock'`.
- Drop the cutover marker (`DROP TABLE IF EXISTS __sprint_e_cutover_gate__;`) so any future
  re-attempt re-trips the mig-387 atomicity gate.
- Revert the app to the pre-cutover commit. `scripts/deploy-local.sh` has no `--rollback`
  flag in this repo — the rollback path is to deploy the previous commit through a temporary
  worktree pointed at the captured SHA. The cutover runbook MUST record the pre-cutover SHA
  before T-0; the rollback runbook reads it back. Plan Task 6.4.1 has the exact commands.
- The rollback **preserves all events** emitted during the window — event log is the
  recovery source if forensics are needed.

**Rollback budget**: 15 min decide + 15 min execute = 30 min total from first alert to
green-light. **Rehearsed** against a `pg_dump`-restored Docker DB the week before cutover
(this is the *only* container plumbing Sprint E ships — purely for rollback rehearsal, not
for testing E itself; grill-me decision 2026-05-28).

**Runbook**: `docs/runbooks/sprint-e-rollback.md` written before cutover, walked through with
Hein on the eve of the deploy. Part of definition of done.

---

## Test plan

With the test-DB infrastructure dropped (grill-me decision: ship fast, accept higher risk),
test plan reduces to four layers:

1. **Static analysis (PR-blocking)**:
   - ESLint `no-direct-serial-status-write` rule
   - `scripts/ci-local.sh` grep gate (`Gate 5`, added next to existing Zero Tolerance)
   - **Gates are the LAST thing enabled in the cutover PR** so the same PR can't be blocked
     by its own gate.
2. **Unit tests** (≥90% branch coverage on `promoteSerial`, each verb, the validate trigger
   tested via in-line SQL fixtures using vitest with `pg.Pool` against a fresh schema in the
   shared DB's test schema namespace, or mocked txn). Every cell of the transition matrix
   gets a passing or rejecting assertion.
3. **Cutover-window assertions**:
   - Pre-backfill row counts match pre-cutover snapshot
   - Post-backfill: 36,264 rows, status distribution sane (`in_stock` ≈ 34.6k, `installed` ≈
     242, `activated` ≈ 1.4k; `pp_flagged` count unchanged at 1,995)
   - Post-deploy: L5 reconcile invariant = 0
   - Six verbs synthetic-data smoke pass (each invoked once with a test serial, assert
     events emitted with expected context, idempotent on second invocation)
4. **Caller enumeration evidence**: the PR description must include the output of an explicit
   `git grep` for every existing `UPDATE stock_serials` and `INSERT INTO stock_serials`
   site, with the file:line:redirect-target documented. Grill-me-decided guardrail against
   missed callers.

---

## Open questions (settled during implementation, not blockers)

1. **`allocate` verb existence today** — is there an "allocate to project" UI flow, or do
   projects just consume from `in_stock` directly via picking? **Decision (2026-05-28):**
   keep `allocated_to_project` in the 8-state vocabulary and the transition matrix. The
   verb's caller enumeration in Track 2.6.1 will confirm whether anything writes it today.
   If no caller exists, the row stays as a documented future-state placeholder (the
   validate-trigger only rejects DISALLOWED transitions, so an unused matrix row is inert
   — the cost of keeping it is one row in the lookup table, the cost of removing it is a
   second migration if the verb later gets added). The spec is `allocated_to_project` is
   reachable; if Track 2.6.1's grep finds zero writers, log it as a follow-up issue rather
   than rewriting the matrix mid-implementation.
2. **NOC ticket → `resolvePp` integration** — does resolving a PP NOC ticket trigger
   `applyPpFlag(serialId, {clear:true})`? If yes, the ticket service needs to import and
   call the verb; if no, OES re-scan picks it up on the next cron run. Resolve during
   implementation by grepping NOC ticket service for pp-resolution handlers.
3. **Bulk-import path** — `import-pp-olt-data.ts` and other bulk scripts: do they go through
   `promoteSerial` with bypass enabled, or are they re-architected to emit per-row verb
   calls? Resolve case-by-case during caller-enumeration pass.

---

## References

- Roadmap parent: `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md`
- Sprint A (ledger): `docs/superpowers/specs/2026-05-26-stock-ledger-consolidation-sprintA-design.md`
- Sprint C (holders): `docs/superpowers/specs/2026-05-26-holder-party-model-sprintC-design.md`
- Sprint D (custody): `docs/superpowers/specs/2026-05-26-pure-custody-model-sprintD-design.md`
- Immediate drift fix: PR #1805 `fix/serial-register-wave2-drift-bugs`
- Cleanup script for the 27 drifted rows: `scripts/cleanup-serial-drift-2026-05-28.ts`
- Memory: `feedback_ont_lifecycle_one_way.md`, `project_serial_register_wave2.md`,
  `project_vlm_serial_learning_audit.md`, `project_stock_locations_custody_roadmap.md`
- Migrations to retire: 365 (`fix_qa_oes_triggers`), 366 (`picking_done_trigger`), 367
  (`drops_install_trigger`)
- Migrations to add: 387 (`serial_lifecycle_state_machine`) + rollback
