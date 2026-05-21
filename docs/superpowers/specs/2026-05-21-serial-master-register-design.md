# Serial Master Register — Phase 4 Design

**Date:** 2026-05-21
**Author:** Claude (with Hein)
**Status:** Spec — awaiting Hein review before plan
**Builds on:** Phase 3 (PR #1678 + 5 followup fixes), audit `docs/superpowers/audits/2026-05-21-procurement-field-stock-integration.md` (commit `3d8322997`)

## Goal

Build a unified master register of ONT and Gizzu serials inside `stock_serials`, so every event — procurement intake, DC receipt, warehouse/project move, field stock allocation, installation, activation, return, repair, scrap — is captured against one source of truth. Provide a serial-first UI that lets storemen and managers search any serial by number or MAC and see its full lifecycle.

## Context — why now

Phase 3 (the technician PWA for issuing + returning stock) shipped to production on 2026-05-20. A pre-Phase 4 audit (`3d8322997`) confirmed five integration leaks that make the existing field-stock module structurally incomplete:

1. **Two parallel `stock_movements` tables** (`stock_movements` Odoo-aware + `field_stock_movements` mig-028) and PWA code wrote to whichever had column-mismatch bugs. Zero successful pickings ever processed in production.
2. **`assets` is the GRN destination**, NOT `stock_serials`. The 36,264 `stock_serials` rows came entirely from `import-serials.ts` Excel imports.
3. **`stock_quants` is empty in production** despite the field-stock UI validating against it.
4. **`contractor_stock_accountability` trigger only logs events**; it never updates `total_issued_count` / `total_returned_count`. PRD-027 §10 blocking logic is structurally broken.
5. **Install data lives in `qa_photo_reviews.ont_serial`**, NOT `stock_serials.installed_at_drop_id` (which is 0 for all 36k serials).

Phase 4 consolidates `stock_serials` as the source of truth, backfills from the parallel sources, fixes the broken triggers, and rebuilds the `/procurement/field-stock/` IA around a serial-centric model.

## Scope (decided during brainstorming + grill)

| Decision | Choice | Source |
|---|---|---|
| Approach | Consolidate (not protect-first, not expand-first) | Grill Q1 |
| Driver | Build the master register (rejection workflow, supplier_return UI etc. deferred) | Grill Q3 |
| Survivor table | `stock_serials` extended; `assets` deprecated for ONT/Gizzu | Grill Q6 |
| Identity key | `serial_number` (with MAC as searchable but non-identity column) | Brainstorm Q1 |
| State model | 12 states (existing 8 + activated + in_repair + allocated_to_project) | Brainstorm Q2 |
| Lifecycle timeline | New `stock_serial_events` append-only log via triggers | Brainstorm Q3 |
| UI scope | Full IA rebuild of `/procurement/field-stock/*` (8 pages rebuilt + 4 new) | Brainstorm Q4-5 |
| Reconciliation | Cross-source disagreements + orphans + accountability counter drift | Brainstorm Q6 |
| Migration strategy | Hybrid: big-bang backfill + write-path cutover (~6-8 weeks total) | Grill Q8 |

## Out of scope (deferred to Phase 5+)

- Return rejection workflow (`status='rejected'` in `stock_returns`)
- `received` intermediate state on returns
- `supplier_return` disposition UI
- Damage-repair workflow beyond `status='in_repair'` (repair-queue management UI)
- `/my/stores/today` mobile dashboard (the PRD-027 "Stores Today" view)
- Migrating other-than-ONT/Gizzu serialised items off `assets`
- Phase 3's deferred safety items (two-call inspect+accept → single endpoint; signature column move; `inspect.ts` atomic transaction; `accept.ts` SELECT FOR UPDATE; idempotency creator-check; `serial-source` scoping). These belong in a separate "Phase 3 safety" track.

---

## Architecture

```
DATA LAYER (Wave 1, ~2-3 weeks)
  Master register: stock_serials (extended)
    - 12-state CHECK
    - Identity: (stock_item_id, serial_number) UNIQUE — existing constraint
    - Searchable columns: serial_number, mac_address, current_holder_staff_id,
                          current_location_id, installed_at_drop_id, status,
                          allocated_to_project_id (new), activated_at_olt_id (new)
  Event log: stock_serial_events (new, append-only)
  Triggers/handlers wired on:
    - GRN confirm
    - stock_pickings status→done (issue / transfer)
    - qa_photo_reviews INSERT with ont_serial
    - oes_pp_data activation row
    - stock_returns INSERT + inspect + accept
    - contractor_stock_accountability counter UPDATEs (the broken-trigger fix)
  Backfill (one-shot, idempotent):
    - assets → stock_serials (ONT/Gizzu only)
    - qa_photo_reviews.ont_serial → stock_serials.installed_at_drop_id
    - oes_pp_data → stock_serials.status='activated'
    - Historical events backfilled into stock_serial_events

UI LAYER (Wave 2, ~3-5 weeks — full IA rebuild)
  Rebuilt (8 pages):
    /procurement/field-stock                  — serial-centric dashboard
    /procurement/field-stock/locations        — warehouse list
    /procurement/field-stock/items            — stock-item catalog
    /procurement/field-stock/serials          — master search (primary view)
    /procurement/field-stock/pickings         — issue events filter view
    /procurement/field-stock/movements        — transfer events filter view
    /procurement/field-stock/returns          — return events filter view
    /procurement/field-stock/accountability   — contractor view, fixed counters
  New (4 pages):
    /procurement/field-stock/serials/[serial]   — lifecycle timeline
    /procurement/field-stock/warehouses/[id]    — per-warehouse drill-down
    /procurement/field-stock/projects/[id]      — per-project drill-down
    /procurement/field-stock/reconciliation     — drift report
```

---

## State machine

12 states + valid transitions.

**Vocabulary:**

```ts
type SerialStatus =
  | 'available'              // in DC or warehouse, ready to use
  | 'reserved'               // earmarked for a planned picking
  | 'allocated_to_project'   // assigned to a project pool
  | 'in_transit'             // moving between warehouses
  | 'issued'                 // with a tech in the field
  | 'installed'              // physically at a drop, pre-activation
  | 'activated'              // live on Nokia OES
  | 'faulty'                 // flagged defective
  | 'in_repair'              // in repair queue
  | 'returned'               // pending inspection
  | 'scrapped'               // written off (terminal)
```

**Transition table:**

| From | To | Triggered by |
|---|---|---|
| (new row) | `available` | GRN confirm / `import-serials.ts` |
| `available` | `reserved` | picking planned |
| `available` | `allocated_to_project` | project allocation |
| `available` | `issued` | direct issue picking executed |
| `available` | `in_transit` | warehouse-to-warehouse transfer started |
| `reserved` | `issued` | planned picking executed |
| `reserved` | `available` | picking cancelled |
| `allocated_to_project` | `issued` | tech picks from project pool |
| `allocated_to_project` | `available` | un-allocated |
| `in_transit` | `available` | arrives at destination |
| `issued` | `installed` | `qa_photo_reviews` insert with `ont_serial` |
| `issued` | `returned` | Phase 3 return wizard |
| `installed` | `activated` | `oes_pp_data` activation row |
| `installed` | `faulty` | post-install fault (NOC ticket) |
| `activated` | `faulty` | active-subscriber fault |
| `activated` | `installed` | deactivation (no longer billed) |
| `faulty` | `returned` | tech brings it back |
| `returned` | `available` | inspect+accept disposition `restock` |
| `returned` | `in_repair` | inspect+accept disposition `repair` |
| `returned` | `scrapped` | inspect+accept disposition `scrap` |
| `in_repair` | `available` | repair complete |
| `in_repair` | `scrapped` | unrepairable |

**Two invariants enforced by triggers + reconciliation:**
1. Every state change emits a `stock_serial_events` row.
2. `stock_serials.status` equals the most recent event's `to_state`.

---

## Event log

```sql
CREATE TABLE stock_serial_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_id       UUID NOT NULL REFERENCES stock_serials(id),
  event_type      VARCHAR(50) NOT NULL,
  from_state      VARCHAR(50),                 -- NULL on initial event
  to_state        VARCHAR(50),
  source_table    VARCHAR(50),                 -- 'stock_pickings', 'qa_photo_reviews', etc.
  source_id       UUID,                        -- FK into source row (no DB FK; cross-table)
  actor_user_id   UUID REFERENCES users(id),
  actor_staff_id  UUID REFERENCES staff(id),
  payload         JSONB DEFAULT '{}'::jsonb,
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sse_serial_time ON stock_serial_events(serial_id, occurred_at DESC);
CREATE INDEX idx_sse_event_type   ON stock_serial_events(event_type, occurred_at DESC);
CREATE INDEX idx_sse_source       ON stock_serial_events(source_table, source_id);
```

### Event type vocabulary (initial; extensible via code; CHECK is permissive)

| Event type | from_state | to_state | Trigger source |
|---|---|---|---|
| `received_at_dc` | NULL | `available` | GRN confirm handler |
| `imported_from_excel` | NULL | `available` | `import-serials.ts` |
| `imported_from_assets` | NULL | (varies) | Backfill script A |
| `reserved` | `available` | `reserved` | picking-create endpoint |
| `unreserved` | `reserved` | `available` | picking-cancel |
| `allocated_to_project` | `available` | `allocated_to_project` | project-allocate endpoint (TBD UI) |
| `unallocated` | `allocated_to_project` | `available` | project-deallocate |
| `transferred` | `available`/`in_transit` | `in_transit`/`available` | stock_pickings type='transfer' status→done |
| `issued` | `available`/`reserved`/`allocated_to_project` | `issued` | stock_pickings type='issue' status→done |
| `installed_at_drop` | `issued` | `installed` | qa_photo_reviews AFTER INSERT |
| `activated` | `installed` | `activated` | oes_pp_data AFTER INSERT |
| `deactivated` | `activated` | `installed` | oes_pp_data row removal |
| `returned` | `issued`/`installed`/`activated`/`faulty` | `returned` | stock_returns AFTER INSERT |
| `inspected` | `returned` | `returned` | inspect endpoint (no state change; logged for audit) |
| `restocked` | `returned` | `available` | inspect+accept disposition='restock' |
| `sent_to_repair` | `returned` | `in_repair` | inspect+accept disposition='repair' |
| `scrapped` | * | `scrapped` | inspect+accept disposition='scrap' OR direct write-off |
| `repaired` | `in_repair` | `available` | repair queue complete (Phase 5 UI; backend ready) |
| `flagged_faulty` | * | `faulty` | manual action OR NOC ticket integration |
| `unflagged_faulty` | `faulty` | (previous) | false-alarm cleared (payload preserves prior state) |
| `force_state_correction` | * | * | admin manual override (requires reason in payload) |

`event_type` column is `VARCHAR(50)` with no CHECK — we add new types by appending code paths, not by migrating CHECK constraints.

---

## Backfill plan

### Step 1 — Schema migration (single migration, idempotent)

`scripts/migrations/sql/361_serial_master_register.sql`:

```sql
-- (a) Extend stock_serials.status CHECK
ALTER TABLE stock_serials DROP CONSTRAINT stock_serials_status_check;
ALTER TABLE stock_serials ADD CONSTRAINT stock_serials_status_check
  CHECK (status IN (
    'available', 'reserved', 'allocated_to_project', 'in_transit',
    'issued', 'installed', 'activated', 'faulty', 'in_repair',
    'returned', 'scrapped'
    -- 'used' status retained from existing data? — verify probe
  ));

-- (b) New columns on stock_serials
ALTER TABLE stock_serials
  ADD COLUMN IF NOT EXISTS allocated_to_project_id UUID REFERENCES projects(id),
  ADD COLUMN IF NOT EXISTS activated_at_olt_id     UUID;
CREATE INDEX IF NOT EXISTS idx_ss_allocated_project
  ON stock_serials(allocated_to_project_id);

-- (c) Event log
CREATE TABLE IF NOT EXISTS stock_serial_events ( ... );  -- per schema above
CREATE INDEX ...;

-- (d) Fix the broken accountability triggers
DROP TRIGGER IF EXISTS trg_update_accountability_on_issue ON stock_pickings;
CREATE OR REPLACE FUNCTION update_accountability_on_issue() ... ;  -- full body, writes counters
CREATE TRIGGER trg_update_accountability_on_issue ... ;

CREATE OR REPLACE FUNCTION update_accountability_on_return() ... ;  -- NEW
CREATE TRIGGER trg_update_accountability_on_return ... ;

-- (e) pg_dump captured before migration runs (operational step)
```

### Step 2 — Backfill scripts (each in own transaction, idempotent)

| Script | Source | Target | Idempotency guard |
|---|---|---|---|
| A | `assets` WHERE asset_type IN ('ont','gizzu') | `stock_serials` | `ON CONFLICT (stock_item_id, serial_number) DO NOTHING` |
| B | `qa_photo_reviews.ont_serial` (latest per serial) | `stock_serials.installed_at_drop_id` + `.status` | `WHERE installed_at_drop_id IS NULL` (never overwrite) |
| C | `oes_pp_data` | `stock_serials.status='activated'` + `.activated_at_olt_id` | `WHERE status IN ('installed','available')` (no downgrade) |
| D | `stock_pickings` + `stock_picking_lines` | `stock_serial_events` (`issued`/`transferred`) | `ON CONFLICT (serial_id, source_table, source_id, event_type) DO NOTHING` |
| E | `stock_returns` + `stock_return_lines` | `stock_serial_events` (`returned`/`inspected`/`restocked`/`sent_to_repair`/`scrapped`) | Same |

### Step 3 — Trigger installation (separate commit)

Triggers on:
- `stock_pickings AFTER UPDATE OF status WHEN NEW.status='done'`
- `stock_returns AFTER INSERT` + `AFTER UPDATE OF status`
- `stock_return_lines AFTER UPDATE OF disposition`
- `qa_photo_reviews AFTER INSERT WHEN NEW.ont_serial IS NOT NULL`
- `oes_pp_data AFTER INSERT/UPDATE`
- GRN confirm function: write to `stock_serials` directly (extend existing handler)

All trigger functions wrap their body in `BEGIN/EXCEPTION` — log and continue, never abort the parent transaction. Drift caught by reconciliation rather than user-facing failures.

### Step 4 — Validation gate (must pass before declaring Wave 1 done)

| Check | Expected | Tolerance |
|---|---|---|
| `assets` ONT/Gizzu rows with no matching `stock_serials` | 0 | 0 |
| `qa_photo_reviews.ont_serial` with no matching `stock_serials` | known set | document, allow |
| `oes_pp_data` with no matching `stock_serials` | known set | document, allow |
| `stock_serials` `status='issued'` but no matching open picking | drift | < 100 |
| `stock_serials.installed_at_drop_id IS NOT NULL` but `status NOT IN ('installed','activated','returned','faulty')` | drift | < 100 |
| `contractor_stock_accountability.total_issued_count` vs `SELECT COUNT(*) FROM stock_pickings WHERE status='done' AND contractor_id=X` | match | 0 drift |
| Same for `total_returned_count` | match | 0 drift |
| `stock_serial_events` row count | ~70-100k | order-of-magnitude check |
| For every `stock_serials` row: latest event's `to_state` == `stock_serials.status` | 100% | 0 drift |

---

## UI structure

### Master search component (`<SerialSearch>`)

Reusable embedded component used by `/serials`, `/warehouses/[id]`, `/projects/[id]`, `/accountability/[contractor]`, etc. — only the default filter set differs.

- Search box: `serial_number` OR `mac_address` (debounced, exact + prefix match)
- Filters: device_type, status (multi), warehouse, project, contractor, tech, drop, last-event date-range
- URL state: all filters serializable + shareable
- Results table: serial, device_type icon, status badge, current location, last event type + relative age, click-through to detail
- Bulk actions (admin only): re-allocate to project, force-state-correction (with reason), export CSV

### Lifecycle timeline component (`<SerialTimeline>`)

- Header: serial + MAC + device-type icon + current status + current location
- Timeline (reverse chronological):
  - Event icon by `event_type`
  - `occurred_at` + actor name
  - `from→to state` chip
  - Expandable `payload` JSON
  - Click-through link to source record (picking, return, qa_photo_review, oes_pp_data, etc.)
- Sidebar links: current picking (if `issued`), current drop (if `installed`), OES record (if `activated`), all returns this serial has gone through
- Admin actions: force-state-correction (modal: reason + target state), add note (emits `note_added` event)

### Reconciliation drift component (`<ReconciliationReport>`)

Three sections:

1. **Cross-source disagreements** — table with columns: serial, drift type, what `stock_serials` says, what source says, last-changed timestamps. Click-through to inspect.
2. **Orphans** — serials with no events; serials with events but no `stock_serials` row; duplicate `serial_number` across stock_items (data hygiene).
3. **Accountability counter drift** — per contractor: derived from triggers vs derived from raw count. Flag where they differ.

Each drift row clickable to inspect. "Mark as resolved" action with reason (audit-logged as event).

### Dashboard tiles (`/procurement/field-stock`)

- Stock-on-hand by status (donut chart across all warehouses)
- Today's activity (issued / returned / installed / activated counts; click → filtered events view)
- Reconciliation drift (red badge if drift > 0; click → /reconciliation)
- Blocked contractors (click → /accountability filtered to `is_blocked=true`)
- Low-stock alerts (per stock_item per warehouse, once `stock_quants` backfilled)

---

## Testing strategy

**Phase 3 lesson: mocked SQL misses real bugs.** For Phase 4, trigger SQL + multi-table backfills are the load-bearing changes; mocking them defeats the test.

| Layer | What | Where |
|---|---|---|
| Unit | trigger SQL functions, event-emitting helpers, state-transition validators | `tests/db/triggers/` (NEW — runs against real Postgres in CI via docker-compose) |
| Unit | UI components (`ReconciliationDriftRow`, `LifecycleTimeline`, `SerialSearchFilters`) | co-located `__tests__/` |
| Integration (REAL DB) | Backfill scripts on copy of prod data — assert row counts, sample-diffs, idempotency | `tests/migrations/` against docker test DB seeded from `pg_dump` |
| Integration (REAL DB) | Trigger fire-paths: INSERT into source table, assert event row exists + serial state updated | `tests/triggers/` |
| Integration (REAL DB) | Reconciliation report queries return expected rows for known drift scenarios | `tests/reconciliation/` |
| API integration | Endpoints serve envelope-shaped JSON (Phase 3 envelope-parse bug guard) | `tests/api/procurement/field-stock/` extend |
| Browser smoke | Full happy path: search → timeline → state-change via Phase 3 wizard → event lands | Playwriter MCP, post-Wave-2 deploy |
| Browser smoke | Reconciliation drift: deliberately introduce drift on test serial, verify report surfaces it | Same |
| Migration safety | Run backfill twice; second run produces zero changes (idempotency check) | CI job |

**Infrastructure:** `docker-compose.test.yml` spins Postgres 15 with anonymised prod-shape data. Vitest integration tests connect via `pg.Pool`. Adds ~30s to CI; catches the entire Phase 3 bug class.

---

## Error handling & rollback

### Error handling

- Trigger bodies wrapped in `BEGIN/EXCEPTION` — log via `RAISE NOTICE`, do NOT abort parent transaction. Prefer "event missed, audited later by reconciliation" over "user's action fails because trigger threw."
- Backfill scripts: each in own transaction. Error → that script's transaction rolls back; prior scripts stay. Resume by re-running.
- API endpoints: standard `apiResponse` envelope, defensive against undefined `serial_id`, etc.
- Reconciliation queries: render drift in UI but never auto-correct. A human reviews + clicks "resolve" with a reason.

### Rollback per stage

| Stage | Rollback |
|---|---|
| Schema migration (Step 1) | `pg_dump` of `stock_serials` taken pre-migration. Restore ~5 min. |
| Backfill (Steps 2-3) | Each script idempotent. Re-run with corrected logic safely converges. Catastrophic: `TRUNCATE stock_serial_events; UPDATE stock_serials SET status='available' WHERE updated_at > '<cutover>'`. |
| Trigger installation (Step 3) | `DROP TRIGGER` reverts; endpoints keep working. |
| UI rebuild (Wave 2) | Each page in own PR. Revert via `git revert <PR>` + redeploy. Legacy pages remain at `/legacy/...` during rebuild for emergency fallback. |

---

## Success criteria

1. **Master register is the source of truth.** GRN, picking, return, install, activation all write to `stock_serials` + emit events. `assets` no longer receives writes for ONT/Gizzu device types.
2. **Lifecycle UI works for any serial.** Search by serial OR MAC returns the right row; timeline shows every event; click-through to source records resolves correctly.
3. **Accountability counters move correctly.** A new issue increments `total_issued_count`; a successful return increments `total_returned_count`; counter drift on reconciliation is zero.
4. **Reconciliation drift < 100 rows** (excluding documented known-cleanup tickets).
5. **Phase 3 wizard still works.** Browser smoke through `/my/stores/return` + `/my/stores/inspect` succeeds end-to-end. No regression.
6. **`npm run ci:quick` clean.** No ratchet regressions.
7. **Production deploy** post-business-hours with Hein's approval.

### Pre-prod browser smoke checklist (extends Phase 3's 12-step)

1. Search by serial → timeline renders with all expected events
2. Search by MAC → resolves to same timeline
3. Open warehouse drill-down → embedded master search filters correctly
4. Open project drill-down → same
5. Trigger an issue via `/my/stores/issue` → event lands in timeline, status updates, accountability counter increments
6. Trigger a return → events land, disposition events render
7. Trigger manual state correction (admin action) → event with reason lands, status updates
8. Force a drift scenario (manually UPDATE one source table without emitting an event) → reconciliation surfaces it on next run
9. Verify legacy `/procurement/field-stock/*` pages still load (during transition)
10. Browser smoke from Phase 3 still passes end-to-end (no regression)

---

## Timeline estimate

| Wave | Work | Duration |
|---|---|---|
| Wave 1 | Schema migration + backfill scripts + triggers + accountability fix | 2-3 weeks |
| Wave 2 | UI rebuild: 8 rebuilt pages + 4 new pages + reusable components | 3-5 weeks |
| **Total** | | **5-8 weeks** |

Decomposed into ~12-15 mergeable PRs (NOT one monster PR). Each gets `/review` or `/review-team` sized to its diff. Browser smoke after each Wave merges.

---

## Open verification items (resolve during plan-writing or early implementation)

1. **`stock_serials` actual current status CHECK** — the existing 8 values are per the audit, but a probe should confirm and capture any extra values (e.g. `'used'` may exist) before the migration ALTER.
2. **`projects` table FK target** — verify the table name + PK type for the `allocated_to_project_id` column.
3. **OLT identifier in oes_pp_data** — confirm the column name + type for `activated_at_olt_id` FK target.
4. **GRN confirm code path** — locate the GRN endpoint that needs to be extended to write to `stock_serials` for ONT/Gizzu intake.
5. **NOC fault ticket integration** — identify the source table + insertion path for `flagged_faulty` events.
6. **Legacy `/procurement/field-stock/*` pages** — decide whether they accessible via `/legacy/...` URLs during the rebuild OR get hidden behind a feature flag.

These are spec-side known unknowns. The plan task list will resolve each as a sub-task (probe + decision) before the implementation step that depends on it.

---

## Resume / next step

Once approved by Hein, invoke `superpowers:writing-plans` to produce the wave-by-wave PR breakdown. The plan should reflect:
- Wave 1 in ~6 PRs (migration, backfill A-E, trigger commit, accountability fix, validation report)
- Wave 2 in ~9 PRs (one per rebuilt page + one per new page + shared component library)
- Each PR has its own TDD-shaped task list following the Phase 2/3 three-role pattern (Implementer → Reviewer → Evaluator)
