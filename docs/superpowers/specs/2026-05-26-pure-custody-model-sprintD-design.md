# Sprint D — Pure Custody Model — Design

**Date:** 2026-05-26
**Status:** Approved design (brainstorm + grill-me complete). Next: implementation plan (`writing-plans`).
**Owner:** Hein
**Module:** Procurement / Field Stock
**Branch / worktree:** `feat/ff-custody-model-sprintD` @ `/home/hein/Workspace/FF_Next.js-ff-custody-sprintD` (off `origin/master` `9e6047be4`)
**Roadmap parent:** `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md` (sub-project **D**, the last one)
**Depends on:** A (ledger consolidation, `#1777`) + C (holder registry, `#1780`) — both shipped.

---

## Purpose

Track field holdings against a **holder** (person / contractor org), not a synthetic
`location_type='technician'` van-location. Custody flows through the **single** double-entry
ledger Sprint A established (`field_stock_movements`); accountability is computed **live** from
that ledger + the custody balance (no trigger-cached counters to drift). D retires the
technician-location pattern, re-keys serial custody to the holder, and rebuilds the
operator-facing Accountability surface around holders.

This is the **full remodel** (decided with Hein): custody balance + serials re-key +
Accountability rebuilt as per-holder rollups + block/unblock + picking/consumption/return rewired
to holders + retire the 5 tech-locations.

---

## Findings (verified against the live shared DB + `origin/master` code, 2026-05-26)

- **The custody side is greenfield.** At the 5 `location_type='technician'` locations there are
  **0** `stock_quants`, **0** `stock_serials`, **0** `field_stock_movements`. System-wide:
  **0** `stock_consumptions`, **0** serials in `status='issued'`, **5** total `stock_pickings`
  (3 of them reference a tech location, all non-`done` drafts). → **No custody data to migrate**;
  D is code + retiring 5 dormant rows + cleaning ≤3 draft pickings.
- **All 5 tech-locations map 1:1 to the 5 `staff` holders C created** (`assigned_to_id` →
  `stock_holders.staff_id`, holder rows already present).
- **`stock_quants` (495 rows / 1.37M units / 12 warehouses)** is the Sprint A Odoo seed, keyed
  `(stock_item_id, location_id, COALESCE(lot_number,''))`, reconciled against Odoo at the
  **warehouse-location** level only. Odoo has no concept of personal van custody — so custody
  **must not** live in `stock_quants` (it would corrupt the Odoo drift math).
- **`stock_movements` (legacy, text-named) is NOT dead.** It is read by
  `pages/api/procurement/stock/index.ts` (movement-history display) and written by
  `grn-confirm.ts` and the Odoo sync. Sprint A made `field_stock_movements` the **balance**
  source and kept `stock_movements` as the **audit/document** layer. → The issue path **keeps**
  its `stock_movements` audit insert and **adds** `field_stock_movements` + custody postings,
  exactly mirroring `grn-confirm`'s dual-write.
- **Blocking is display-only today.** Neither `pickings/index.ts` (create) nor
  `pickings/[pickingId]/process.ts` (process→done) checks `is_blocked`. Block-state is only
  *recorded* (block/unblock endpoints + auto-block on reconcile when `unaccounted>0`) and
  *displayed* (two dashboards). SOP-4.4 ("blocked contractor cannot receive stock") is documented
  but unimplemented. → Keeping block display-only in D is **behavior-preserving**.
- **Two accountability surfaces exist today**, both consuming `contractor_stock_accountability`:
  - contractor-grain: `pages/api/procurement/field-stock/accountability/*` +
    `AccountabilityTabContent`/`ContractorAccountabilityList` (the procurement tab),
    `dashboard.ts`, `dashboardV2Service.ts`.
  - technician-grain: `src/modules/field-stock/services/reconciliationService.ts` +
    `DailyReconciliationDashboard.tsx` (auto-blocks per technician).
  `contractor_stock_accountability` is **empty** (no data risk), but the code surface is real.
- **`stock_movements` and `contractor_stock_accountability` consumers map** (above) — D keeps both
  tables alive behind shims and migrates consumers as fast-follows, not in core D.
- **Picking process path** (`pages/api/procurement/field-stock/pickings/[pickingId]/process.ts`)
  uses bare `neon` + manual `BEGIN/COMMIT`, writes `stock_quants` (debit source / credit dest),
  sets `stock_serials.current_location_id = destination, status='issued'`, and inserts
  `stock_movements`. It does **not** write `field_stock_movements` and carries **no** holder.
- **Consumption path** (`consumptionService.recordConsumption`) already writes
  `field_stock_movements(consumption, from_location_id)` + decrements `stock_quants`; marks the
  serial installed (but does **not** clear `current_location_id`). Carries no holder.
- **Return path** (`returns/[returnId]/accept.ts`) sets serial `current_location_id = warehouse,
  status='available'`; the `stock_movements` integration is a deferred TODO.
- **Two picking-done triggers coexist on `stock_pickings`:**
  - `trg_update_accountability_on_issue` / `update_accountability_on_issue()` (mig **029**) —
    only ensures a `contractor_stock_accountability` row exists; no counters. **Fully obsolete.**
  - `trg_emit_serial_event_on_picking_done` / fn (mig **366**, replacing 364) — does three things:
    (1) emit `stock_serial_events`, (2) set serial `status`, (3) increment
    `contractor_stock_accountability.total_issued_count` for contractor pickings. Only (3) is
    obsolete under the live-view model.
- **Next migration version is 384** (`SELECT MAX(version) FROM migrations` = 383, Sprint C).
  Re-confirm + `gh pr list --search 'migration in:title'` immediately before opening the PR.

---

## Decisions (locked with Hein)

### 1. Scope — full remodel now
Build all of D while the custody side is greenfield/low-risk, before the field-stock PWA issues
real van stock. (Alternatives "foundation-only" / "spec-then-foundation" rejected.)

### 2. Custody balance — a separate `stock_custody` table, posted through the one ledger
A holder-keyed balance table parallel to location-keyed `stock_quants`. Custody movements **still
post through `field_stock_movements`** (nullable `from_holder_id`/`to_holder_id` + a per-side
exactly-one-endpoint CHECK), preserving Sprint A's single double-entry ledger. Rejected:
generalising `stock_quants` to accept `holder_id` (reverses A's location-only decision; forces
every quants reader + the Odoo reconcile to filter holder rows or corrupt warehouse drift);
standalone custody with no shared ledger (abandons double-entry).

### 3. Accountability — identity stays thin; persistent decisions in a thin table; numbers via a view
- `stock_holders` stays **identity-only** (`is_active`); no block column (C's decision holds).
- A thin **`stock_accountability`** table (keyed `holder_id` UNIQUE) holds only the persistent
  human decisions: block-state + recovery amounts + reconciliation stamps.
- A **`v_holder_accountability`** view computes `issued/consumed/returned/held/unaccounted` live
  from `field_stock_movements` + `stock_custody`, `LEFT JOIN stock_accountability` for block-state.
  No trigger-cached counters (the old contractor table is empty/drifted precisely because counts
  were trigger-maintained).

### 4. Block grain — holder grain, display-only (behavior-preserving)
Block-state lives per-holder in `stock_accountability`. Contractor-level "blocked" is **derived**
(any holder of the contractor blocked) via `v_contractor_accountability`. D adds **no** new
enforcement gate on issuing (blocking is display-only today); a clearly-marked seam is left for
when issuing goes live. Rejected: holder-grain-enforced-now and contractor-grain-enforced-now
(both add new issue-time behavior best designed against the real issue UX).

### 5. `contractor_stock_accountability` migration — dormant table behind a rollup shim
Keep the (empty) `contractor_stock_accountability` table in place behind a new
`v_contractor_accountability` rollup view so the legacy contractor-grain + technician-grain
consumers keep working. Re-point the **primary** procurement Accountability tab to holder-grain in
D; migrate the secondary consumers (`dashboard.ts`, `dashboardV2Service`, `reconciliationService` +
`DailyReconciliationDashboard`, `/contractor` + `/kpi` skill docs) as **fast-follows**, not in
core D. Dropping the old table is a later cleanup once all consumers are migrated.

---

## Schema — migration 384 (`pure_custody_model`)

```sql
-- 1. Custody balance (holder-keyed; mirrors stock_quants' shape + ON CONFLICT key)
CREATE TABLE stock_custody (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id          uuid NOT NULL REFERENCES stock_holders(id),
  stock_item_id      uuid NOT NULL REFERENCES stock_items(id),
  lot_number         varchar(100),
  quantity           numeric(12,3) NOT NULL DEFAULT 0,
  reserved_quantity  numeric(12,3) DEFAULT 0,
  unit_cost          numeric(12,2),
  total_value        numeric(14,2),
  last_movement_date timestamptz,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX stock_custody_unique
  ON stock_custody (holder_id, stock_item_id, COALESCE(lot_number, ''));   -- ON CONFLICT target
CREATE INDEX idx_stock_custody_holder ON stock_custody (holder_id);
CREATE INDEX idx_stock_custody_item   ON stock_custody (stock_item_id);

-- 2. Persistent accountability decisions only (numbers come from the view)
CREATE TABLE stock_accountability (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id                uuid NOT NULL UNIQUE REFERENCES stock_holders(id),
  is_blocked               boolean NOT NULL DEFAULT false,
  blocked_reason           text,
  blocked_at               timestamptz,
  blocked_by               varchar(255),
  pending_recovery_amount  numeric(14,2) DEFAULT 0,
  recovered_amount         numeric(14,2) DEFAULT 0,
  last_reconciliation_date timestamptz,
  last_reconciliation_by   varchar(255),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_accountability_blocked ON stock_accountability (is_blocked);

-- 3. Holder endpoints on the single ledger (back-compatible: existing 496 rows have holder cols NULL)
ALTER TABLE field_stock_movements
  ADD COLUMN from_holder_id uuid REFERENCES stock_holders(id),
  ADD COLUMN to_holder_id   uuid REFERENCES stock_holders(id);
-- a side is a location XOR a holder XOR null (NOT both). Existing receipts (holder cols NULL) pass.
ALTER TABLE field_stock_movements
  ADD CONSTRAINT field_stock_movements_from_endpoint_chk
    CHECK (from_location_id IS NULL OR from_holder_id IS NULL),
  ADD CONSTRAINT field_stock_movements_to_endpoint_chk
    CHECK (to_location_id IS NULL OR to_holder_id IS NULL);
CREATE INDEX idx_fsm_from_holder ON field_stock_movements (from_holder_id) WHERE from_holder_id IS NOT NULL;
CREATE INDEX idx_fsm_to_holder   ON field_stock_movements (to_holder_id)   WHERE to_holder_id   IS NOT NULL;

-- 4. Holder on serials + the issue/consume documents
ALTER TABLE stock_serials      ADD COLUMN holder_id uuid REFERENCES stock_holders(id);
ALTER TABLE stock_pickings     ADD COLUMN holder_id uuid REFERENCES stock_holders(id);  -- recipient (issue)
ALTER TABLE stock_consumptions ADD COLUMN holder_id uuid REFERENCES stock_holders(id);  -- custody source
CREATE INDEX idx_stock_serials_holder ON stock_serials (holder_id) WHERE holder_id IS NOT NULL;

-- 5. Live accountability view (holder grain)
CREATE VIEW v_holder_accountability AS
SELECT
  h.id   AS holder_id,
  h.holder_type, h.staff_id, h.contractor_id, h.name, h.is_active,
  COALESCE(iss.cnt, 0)  AS issued_count,    COALESCE(iss.val, 0)  AS issued_value,
  COALESCE(con.cnt, 0)  AS consumed_count,  COALESCE(con.val, 0)  AS consumed_value,
  COALESCE(ret.cnt, 0)  AS returned_count,  COALESCE(ret.val, 0)  AS returned_value,
  COALESCE(held.qty, 0) AS held_count,      COALESCE(held.val, 0) AS held_value,
  COALESCE(iss.cnt,0) - COALESCE(con.cnt,0) - COALESCE(ret.cnt,0) - COALESCE(held.qty,0)
                        AS unaccounted_count,
  COALESCE(sa.is_blocked, false) AS is_blocked,
  sa.blocked_reason, sa.blocked_at, sa.blocked_by,
  COALESCE(sa.pending_recovery_amount, 0) AS pending_recovery_amount,
  COALESCE(sa.recovered_amount, 0)        AS recovered_amount,
  sa.last_reconciliation_date, sa.last_reconciliation_by
FROM stock_holders h
LEFT JOIN stock_accountability sa ON sa.holder_id = h.id
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val
                   FROM field_stock_movements WHERE to_holder_id   = h.id AND movement_type='issue')       iss ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val
                   FROM field_stock_movements WHERE from_holder_id = h.id AND movement_type='consumption') con ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) cnt, SUM(total_cost) val
                   FROM field_stock_movements WHERE from_holder_id = h.id AND movement_type='return')      ret ON true
LEFT JOIN LATERAL (SELECT SUM(quantity) qty, SUM(total_value) val
                   FROM stock_custody WHERE holder_id = h.id)                                              held ON true;

-- 6. Contractor rollup shim (keeps legacy contractor-grain consumers alive)
CREATE VIEW v_contractor_accountability AS
SELECT
  h.contractor_id,
  SUM(va.issued_count)        AS total_issued_count,
  SUM(va.consumed_count)      AS total_consumed_count,
  SUM(va.returned_count)      AS total_returned_count,
  SUM(va.held_count)          AS current_held_count,
  SUM(va.held_value)          AS current_held_value,
  SUM(va.unaccounted_count)   AS unaccounted_count,
  bool_or(va.is_blocked)      AS is_blocked,            -- contractor blocked if ANY holder blocked
  SUM(va.pending_recovery_amount) AS pending_recovery_amount
FROM v_holder_accountability va
JOIN stock_holders h ON h.id = va.holder_id
WHERE h.contractor_id IS NOT NULL
GROUP BY h.contractor_id;
```

- `total_cost`/`total_value` columns already exist on `field_stock_movements` / `stock_custody`;
  the issue/consume/return postings must populate them for the value rollups to be correct.
- Exact `unaccounted` semantics (issued − consumed − returned − held should net ~0 in steady state)
  to be unit-tested; finalize the formula sign conventions in the plan against real postings.
- A matching `rollback_384_pure_custody_model.sql` drops views, columns, constraints, indexes, and
  the two tables, and restores the mig-029/366 trigger bodies.

---

## Data flow (all postings in one `pg.Pool` transaction; mirror `postGrnReceiptLines`)

| Flow | Quants/Custody | `field_stock_movements` | Serial | Audit |
|------|----------------|--------------------------|--------|-------|
| **Issue** (picking→done, `picking_type='issue'`) | debit `stock_quants` source location; **credit `stock_custody` holder** | `issue`: `from_location_id`=source, `to_holder_id`=recipient | `holder_id=h, status='issued', current_location_id=NULL` | **keep** existing `stock_movements` insert |
| **Transfer** (location→location) | debit/credit `stock_quants` both sides (unchanged) | `transfer`: `from_location_id`/`to_location_id` | `current_location_id=dest` | keep `stock_movements` |
| **Consume** (`recordConsumption`) | **debit `stock_custody` holder** | `consumption`: `from_holder_id`=h | `status='installed', installed_at_drop_id`, **clear `holder_id`** | — |
| **Return** (`returns/accept`) | **debit `stock_custody` holder**; credit `stock_quants` warehouse | `return`: `from_holder_id`=h, `to_location_id`=WH | `status='available', current_location_id=WH`, **clear `holder_id`** | — |

Serial custody model: a serial is at a **location** (`current_location_id`), with a **holder**
(`holder_id`), **installed** at a drop (`installed_at_drop_id`), or otherwise idle — driven by
`status`. No new CHECK on serials (the 11-status state machine makes a hard constraint brittle);
the app sets/clears the dimensions on issue/consume/return and unit tests assert the invariants.

---

## Services & code changes

1. **New `custodyService.ts`** (`src/modules/procurement/field-stock/services/`) — executor-injected
   core (`postIssueToHolderWith` / `postConsumeFromHolderWith` / `postReturnFromHolderWith`),
   unit-testable with a fake exec, mirroring Sprint A's `postGrnReceiptLines`; + db-pool wrappers.
   Each posting upserts `stock_custody` (`ON CONFLICT (holder_id, stock_item_id, COALESCE(lot,''))`)
   and inserts the balancing `field_stock_movements` row. Keep < 300 lines; split if needed.
2. **Rewrite `pickings/[pickingId]/process.ts`** → `pg.Pool` `transaction()` (off bare neon
   `BEGIN/COMMIT`). For `picking_type='issue'`: resolve recipient holder (from `holder_id`/
   `technician_id`/`contractor_id` via C's resolvers), post the issue (debit source quant → credit
   custody), set serial holder/status; **keep** the `stock_movements` audit insert. Non-issue
   picking types keep their location→location quant behavior.
3. **`consumptionService.recordConsumption`** → debit custody from `holder_id`; post
   `field_stock_movements(consumption, from_holder_id)`; clear serial `holder_id` on install.
4. **`returns/[returnId]/accept.ts`** → debit custody, credit warehouse; post
   `field_stock_movements(return, from_holder_id, to_location_id)`; clear serial `holder_id`.
5. **Holder resolution in the issue flow** (reuse C's `getOrCreate{Staff,Contractor,External}Holder`);
   set `stock_pickings.holder_id` at confirm.
6. **Accountability API** (`pages/api/procurement/field-stock/accountability/*`) → new holder-keyed
   reads from `v_holder_accountability`; block/unblock/reconcile write `stock_accountability`
   (holder-keyed). The contractor-keyed legacy routes keep working via `v_contractor_accountability`.
7. **Primary Accountability UI** (`AccountabilityTabContent` / `ContractorAccountabilityList` /
   `useContractorAccountability`) → holder-centric list (block/unblock per holder; contractor rollup
   available). Per `feedback_module_nav`, keep the existing tab/nav shell.

---

## Trigger cleanup (verified safe — R3)

- **`DROP TRIGGER trg_update_accountability_on_issue ON stock_pickings`** + `DROP FUNCTION
  update_accountability_on_issue()` (mig 029) — fully obsolete; the view needs no pre-existing row.
- **`CREATE OR REPLACE FUNCTION trg_emit_serial_event_on_picking_done()`** (mig 366) keeping blocks
  (1) `stock_serial_events` emission and (2) serial `status` update, and **removing only block (3)**
  the `contractor_stock_accountability` counter INSERT/UPDATE. No trigger re-binding. The rollback
  restores block (3).
- The app code (`process.ts`) and the trigger both set serial `status` on issue→done; both write
  `'issued'`, so they stay consistent. The app additionally sets `holder_id` (the trigger does not).

---

## Cutover (greenfield)

- **Deactivate the 5 `location_type='technician'` rows** (`is_active=false`; keep rows for history
  — 0 quants/serials/movements reference them).
- **Deprecate `getOrCreateTechnicianLocation`**: stop minting technician locations; the issue flow
  targets a holder. Keep a thin shim or migrate its callers (decide in the plan). C's dual-write
  into `stock_holders` is now the authoritative path.
- **Clean the ≤3 stray draft pickings** referencing tech locations (inspect first; delete if test
  data, else leave — they are non-`done`).
- **Backfill/migration ordering:** migration 384 + cutover are **controller-owned** (never
  delegated to implementer subagents), per `feedback_subagent_db_mutations_controller`.

---

## Out of scope (named; fast-follows unless noted)

- Migrating the **secondary** accountability consumers to holder-grain: `dashboard.ts`,
  `dashboardV2Service`, `reconciliationService` + `DailyReconciliationDashboard`, and the
  `/contractor` + `/kpi` skill docs (all kept working via `v_contractor_accountability`).
- **Dropping `contractor_stock_accountability`** — later cleanup once all consumers migrated.
- **Enforcing block at issue time** (SOP-4.4) — seam left; needs the real issue UX.
- **Finishing A's ledger consolidation for transfer/return** beyond what D's flows require.
- SMME `contractor_class` attribute on `contractors` — future procurement reporting.
- Reserved-quantity / allocation semantics on `stock_custody` beyond a column parity with quants.

---

## Validation gates

- **Custody nets to zero:** issue → hold → consume for a holder leaves `stock_custody.quantity = 0`
  for that (holder, item); `v_holder_accountability.held = issued − consumed − returned`.
- **Serial invariant:** every `status='issued'` serial has a non-null `holder_id` and null
  `current_location_id`; on consume `holder_id` is cleared and `installed_at_drop_id` set; on return
  `holder_id` cleared and `current_location_id` = warehouse.
- **Ledger CHECK (negative test):** a `field_stock_movements` row with both `from_location_id` and
  `from_holder_id` set is rejected; existing 496 receipt rows still pass.
- **Double-entry:** every issue/consume/return posting writes exactly one balancing
  `field_stock_movements` row with the correct holder/location endpoints and populated
  `quantity`/`total_cost`.
- **custodyService unit tests** (fake exec) for issue/consume/return, incl. `ON CONFLICT`
  idempotency and value rollups.
- **Accountability:** the holder Accountability tab lists the 5 holders; block/unblock persists to
  `stock_accountability`; `v_contractor_accountability` returns the legacy shape so dashboards
  remain functional.
- **Build/lint:** `tsc --noEmit` clean; `npm run ci:quick` clean (no new errors; warnings within
  the 185 ratchet). UI verified in-browser per `feedback_verify_before_confirm`.

---

## Risks & mitigations

- **`process.ts` neon→pg.Pool rewrite on a live (low-volume) path** (med) — covered by the
  nets-to-zero gate + custodyService unit tests; only 5 historical pickings, 3 drafts.
- **Visible UI change** (Accountability tab contractor→holder grain) (med) — the spec-review
  checkpoint precedes any code; contractor rollup remains available via the shim view.
- **Value rollups depend on postings populating `total_cost`/`total_value`** (med) — explicit
  validation gate; assert non-null cost on every custody posting in unit tests.
- **`unaccounted` formula sign/edge cases** (low–med) — pin the exact formula in the plan against
  real postings before relying on it for blocking display.
- **Migration version collision** (low) — re-confirm `SELECT MAX(version)` + `gh pr list --search
  'migration in:title'` immediately before the PR (`feedback_parallel_session_migration_coordination`).
- **File-size limits** (low) — `custodyService` and the rewritten `process.ts` kept < 300 lines;
  split proactively (`feedback_file_size_limit_strict`).

---

## Task DAG (for `writing-plans`)

```
T1  migration 384 (tables + columns + CHECKs + 2 views + trigger cleanup + rollback)   [controller-owned]
        │
        ├─> T2  custodyService.ts (executor-injected postings + db-pool wrappers) + unit tests
        │        │
        │        ├─> T3  rewrite pickings/process.ts (issue → custody, pg.Pool txn, keep audit)
        │        ├─> T4  rewire consumptionService (debit custody, clear serial holder)
        │        └─> T5  rewire returns/accept (debit custody, credit warehouse)
        │
        └─> T6  retire 5 tech-locations + deprecate getOrCreateTechnicianLocation        [controller-owned cutover]
        
T7  accountability API → holder grain (reads v_holder_accountability; writes stock_accountability)   [after T1]
        └─> T8  primary Accountability UI → holder-centric                                [after T7]
T9  cutover/cleanup: draft pickings, fast-follow notes, doc flags                          [last]
```

Likely 6–8 stacked PRs (file-size limits + review-team blind review). Each PR: `ci:quick`+`tsc`
before push, review-team with the **raw** diff, merge only after blind-review APPROVED + CI green.

---

## Acceptance (D is done when)

Custody balances live in `stock_custody`, every custody move posts a balancing
`field_stock_movements` row (issue/consume/return nets to zero per holder), serials carry holder
custody, the operator Accountability tab is holder-centric with persisted block-state, the legacy
contractor/technician consumers still function via `v_contractor_accountability`, the 5
technician-locations are retired, the obsolete accountability triggers are cleaned, and
`tsc --noEmit` + `ci:quick` are clean — closing out the stock-locations/custody roadmap (B+A+C+D).
