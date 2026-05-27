# Stock Locations & Custody — Roadmap

**Date:** 2026-05-25
**Status:** Approved roadmap (decomposition). Each sub-project (A–D) gets its own spec → plan → implementation cycle.
**Owner:** Hein
**Module:** Procurement / Field Stock

---

## North star

One authoritative, location-aware, double-entry stock ledger, with field holdings tracked
against **people/parties (custody)** rather than synthetic "technician locations", plus a real
location-management surface to administer it.

---

## Why this exists (audit findings, 2026-05-25)

The system today has **two disconnected stock subsystems**:

| | System A — Procurement/GRN (in real use) | System B — Field-stock (effectively dormant) |
|---|---|---|
| Balance table | `stock_items.qty_available` — **global qty, no location dimension** | `stock_quants` — keyed by `location_id` |
| Movement ledger | `stock_movements` — `from_location`/`to_location` are **text names**, no FK | `field_stock_movements` — `from_location_id`/`to_location_id` UUID FKs |
| Live volume (2026-05-25) | GRNs **325**, movements **341**, items **298** | quants **0**, movements **1**, pickings **5** |

Consequences confirmed against the live DB:

- **`stock_quants` is empty.** The entire location-aware inventory holds nothing, so the
  "clean" double-entry transfer path (pickings → debit/credit `stock_quants`) cannot run —
  there is nothing in it to move.
- **GRN confirm never writes `stock_quants`.** It only increments the global
  `stock_items.qty_available` and logs a text-named movement. So you know *how much* of an item
  exists company-wide, never *where* it sits.
- **The two movement ledgers are different tables**, not one table with mixed schemas:
  `stock_movements` has only text `from_location`/`to_location`; the UUID `*_location_id`
  columns live in `field_stock_movements`.
- **No central DC location exists.** The 14 `warehouse`-type rows are mostly site stores
  (Etwatwa, Lawley, Mohadin, Tembisa 1/2/3, …). There is no Garstfontein/Pretoria hub; closest
  stand-ins are `WH-MAIN` (Main Warehouse) and `WH-WH` (VelocityFibre).
- **Technicians are modelled as locations.** `getOrCreateTechnicianLocation` auto-spawns a
  `technician`-type, `is_virtual` location ("{Name}'s Van Stock", `TECH-xxxx`) keyed to
  `assigned_to_id`. The **Accountability** module is built on top of this: it derives "what a
  person holds" by joining `stock_quants → stock_locations WHERE location_type='technician'`,
  with a `contractor_stock_accountability` rollup + block/unblock logic.
- **Location editing UI does not exist.** `locationService` has full `updateLocation` /
  `deleteLocation`, but no UI wires them up — `CreateLocationModal` is create-only, and the
  `LocationList` row click only selects. The create form also ignores DB-supported fields
  (`coordinates`, `project_id`, `parent_id`).

### Odoo is NOT a constraint
We do **not** continually sync to Odoo. There is **no Odoo cron** on velo; the location-aware
sync entities (`stockReceiptSync.ts`, `stockTransferSync.ts`) are **dead code** (imported
nowhere); Odoo stock sync is manual + pull-based (`POST /api/odoo/sync/stock-movements` +
`scripts/odoo-sync-*.ts`). The only live Odoo location coupling is at `location_type='warehouse'`
level via `odoo_location_mappings`. Therefore re-keying custody from `location_id` → person
breaks no live integration. Combined with `stock_quants` being empty, the custody remodel is
**low-risk now** and will not be once real van-stock data accumulates.

---

## Sub-projects

### A — Stock ledger consolidation *(keystone; blocks D)*

**Goal:** a single authoritative, location-keyed, double-entry ledger.

**Scope / decisions**
- Canonical **balance** = `stock_quants` (item × location × project, with `reserved_quantity`).
- Canonical **posting ledger** = `field_stock_movements` (UUID FKs, picking/consumption refs).
  The text-based `stock_movements` path stops being a balance source (kept, if needed, only as
  a higher-level document/reference — not the source of truth).
- **GRN confirm** must, in one transaction, for each accepted line:
  upsert `stock_quants(item, destination_location, project) += qty` **and** insert a balancing
  `field_stock_movements` posting (from a virtual "Vendors" location → destination).
- Introduce a **virtual "Vendors" location** so the from-side of a receipt is a real
  `location_id` (mirrors the existing virtual `ADJUST` location pattern).
- `stock_items.qty_available` becomes **derived** (SUM of quants) rather than independently
  mutated — via a view (`v_stock_on_hand`) and/or a same-transaction cache if perf requires.

**Migration / backfill**
- 325 historical GRNs posted only to `qty_available` → generate opening-balance `stock_quants`
  rows + opening movements. Dry-run against prod, per-category test seeds, row-level audit log
  before `--commit` (per `feedback_run_backfills_through_verification_first`).

**Validation gates**
- A GRN confirm raises destination on-hand by **exactly** the accepted quantity.
- Every movement nets to zero across locations; no orphan quant lacking a movement.
- `v_stock_on_hand` reconciles to legacy `qty_available` for migrated data.

**Risks**
- Backfill correctness on historical GRNs; double-counting if `qty_available` is also still
  mutated during transition. Mitigate with a hard cutover of the write path + reconciliation.

---

### B — Location management v2 *(independent; recommended first build)*

**Goal:** full location lifecycle UI + a coherent location taxonomy.

**Scope / decisions**
- **Edit + soft-delete UI** (wire the existing `updateLocation` / `deleteLocation`).
  Delete/deactivate **blocked when `stock_quants` > 0** at that location.
- Richer create/edit form: `coordinates`, `project_id` link (dropdown), `parent_id` hierarchy
  picker — all DB-supported, all currently omitted.
- **Location taxonomy:** distinguish **hub/DC** from **site store**. Recommended mechanism:
  parent hierarchy (DC = root, site stores = children) rather than a new flag. *(Final
  mechanism — hierarchy vs `is_hub` flag — resolved in the B-spec.)*
- Create the real **Garstfontein DC** location record as the hub.
- **Hide system/virtual locations** (`technician`, `adjustment`, `scrap`, virtual `transit`)
  from the general setup list — admins manage physical locations only. (Technician handled
  fully in D; for B it is just filtered out of the setup surface.)
- *Optional, surgical:* `locationService` currently mixes the Neon shim (`neon()`) with the
  param-based `query()`. If we are editing it for the edit UI, migrate it to `pg.Pool`. Flag,
  do not force.

**Validation gates**
- Edits persist; delete blocked when stock present; the DC appears and is selectable in GRN;
  technician rows no longer in the setup list; `npm run ci:quick` + `tsc --noEmit` clean.

**Risks**
- GRN destination selection currently filters to `warehouse`/`internal`. The hub/site
  distinction must keep that selection working.

---

### C — Holder / party model *(prereq for D)*

**Goal:** a unified, typed holder reference for custody.

**Scope / decisions**
- `holder_type ∈ {internal_staff, external, smme, contractor}` (+ `team`? — to confirm).
- Representation: a thin **`stock_holders`** registry — `(id, holder_type, ref_id, name,
  contact, is_active, blocked, …)` — giving custody/accountability a **single FK**, with a
  polymorphic `ref_id` resolving to `staff` / `contractors` / `technicians` per `holder_type`,
  and a home for **external persons** who have no other table.
- Map the 5 existing technician locations' `assigned_to_id` → holder records.

**Open questions (resolve in C-spec)**
- How is an **SMME** represented today? `contractors` has **no** `contractor_type` /
  `company_type` column, so internal/external/SMME classification is **net-new** — decide
  whether SMME is a sub-type of `contractors` or a separate concept.
- Is **`team`** a holder type, or do teams only ever hold via their members?

**Validation gates**
- Every existing technician / contractor maps to exactly one holder; holder list is deduped.

---

### D — Pure custody model *(the technician rethink; needs A + C)*

**Goal:** field holdings keyed to a holder, not a synthetic location; Accountability rebuilt.

**Scope / decisions**
- New balance: a **`stock_custody`** table (holder × item/serial × qty) parallel to
  `stock_quants(location)`. *(Alternative considered: generalise `stock_quants` to accept
  either `location_id` or `holder_id`. Decide in the D-spec; `stock_custody` is the leading
  option for clarity.)*
- Serials: replace `stock_serials.current_location_id` semantics — **holder** when issued,
  **drop** when installed.
- Rebuild **Accountability** (`contractor_stock_accountability`) + block/unblock as **rollups
  from custody** (per holder, optionally aggregated to contractor).
- Migrate `getOrCreateTechnicianLocation` → auto-create **holder**; stop creating
  `technician`-type locations; deactivate the existing 5.

**Validation gates**
- Issue → hold → consume nets to zero per holder; accountability totals reconcile against
  movements; no `issued` serial exists without a holder.

**Risks**
- Largest blast radius — touches serials (34k+ rows), Accountability, picking `process`, and
  consumption. Must land **after A** (real balances) and **after C** (holder identity).

---

## Dependency DAG & order

```
A ─┐
   ├──> D
C ─┘
B  (independent)
```

- **A** and **B** are independent and parallel-able.
- **C** is independent of A/B but is a prerequisite for **D**.
- **D** requires **A + C**.

**Recommended order:** **B → A → C → D**
(B delivers the literal ask + the real DC and hub/site distinction the supplier→DC→project
flows need; A is the keystone that makes balances real; C→D is the larger custody remodel once
the ledger holds data.)

---

## Cross-cutting rules (every sub-project)

- One **worktree + branch per spec**, branch name carrying a project identifier.
- Every change via **PR**; never commit to master. Run `npm run ci:quick` + `tsc --noEmit`
  before each PR. Use **review-team** (blind review) for code PRs; pass the raw diff.
- Migrations live in **`scripts/migrations/sql/`**; pick the version from
  `SELECT MAX(version) FROM migrations` (not `ls`); run `\d <table>` against the live DB before
  writing/reviewing any migration with column references.
- **No credentials** in spec/plan docs — reference `$PGPASSWORD` / env vars only.
- Prod-mutating backfills: dry-run against prod + per-category test seeds + row-level audit log
  before `--commit`.

---

## Out of scope (for now)

- Pushing FibreFlow stock → Odoo on a schedule (no live sync exists; not part of this work).
- Reworking warehouse-level Odoo receipt mapping (`location_type='warehouse'` /
  `odoo_location_mappings`).
- Procurement upstream (BOQ/RFQ/PO/approvals) — unchanged; this roadmap starts at GRN/receipt.

---

## Three target flows (acceptance lens)

The roadmap is "done enough" when these three behave end-to-end with correct, location/holder-aware balances:

1. **Supplier → Central DC** — receive into the Garstfontein DC; DC on-hand rises; balancing movement recorded.
2. **Supplier → Project directly** — receive straight into a site-store / project location (selectable at GRN), bypassing the DC.
3. **Supplier → DC → Project** — receive into DC, then transfer DC → site store; source debited, destination credited atomically; later issued into a holder's custody and consumed against a drop.
