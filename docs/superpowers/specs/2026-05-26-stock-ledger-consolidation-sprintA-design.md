# Sprint A — Stock Ledger Consolidation (Design Spec)

**Date:** 2026-05-26
**Status:** Approved design (grilled). Ready for implementation plan.
**Owner:** Hein
**Module:** Procurement / Field Stock
**Worktree / branch:** `FF_Next.js-stock-ledger-sprintA` / `feat/ff-stock-ledger-consolidation` (off `deeb7949e`)
**Parent roadmap:** `docs/superpowers/specs/2026-05-25-stock-locations-custody-roadmap-design.md` (sub-project A)

---

## 1. Goal

Make FibreFlow the authoritative, **location-aware** stock ledger, starting at GRN confirm:

1. **Seed** accurate opening balances per (item × location) from Odoo's live inventory.
2. **Post go-forward** GRN receipts atomically into `stock_quants` + `field_stock_movements`.
3. **Reconcile** FibreFlow against Odoo on demand to measure drift until outflow capture lands (sub-projects C/D).

FibreFlow becomes the source of truth; Odoo seeds the opening balance and then serves as the reconciliation reference, not a continuously-synced master.

---

## 2. Key discovery that reshaped this spec

The parent roadmap assumed FibreFlow's `qty_available` (or GRN replay) was the only available stock signal and that Odoo was out-of-loop. **Investigation against the live DB and live Odoo proved otherwise:**

| Source | On-hand total | Location-aware? | Trust |
|--------|---------------|-----------------|-------|
| FibreFlow `stock_items.qty_available` | 115,703 | No (global) | **Stale** — serialized items read 13 vs 34,692 `available` serials |
| FibreFlow `stock_quants` | 0 rows | Yes | Empty |
| **Odoo `stock.quant`** (`velocityfibre.odoo.com`) | **1,370,112** | **Yes — 16 internal locations** | **Live, actively maintained** |

Supporting facts (all verified):
- All 325 completed GRNs have `warehouse_id` defaulted to the **`FAULTY` bin** — `grn.warehouse_id` is garbage as a location source.
- Bulk-material outflows are **unrecorded**: `stock_consumptions = 0`, `stock_pickings = 5`, `field_stock_movements = 1`. The 846k-unit drawdown (962k gross received → 115k qty_available) cannot be reconstructed → **GRN-replay backfill is fiction** and is rejected.
- Serialized items (`stock_serials`, 36,264 rows) cover only **6 SKUs**; rich but narrow.
- **Odoo seed is ~100% mappable:** 139/140 Odoo products match FibreFlow `stock_items.item_code` exactly (only "Vendor Labour", a service, misses); Odoo's 16 locations map deterministically to FibreFlow warehouse codes (`Law/Stock`→`WH-Law`, `Moh/Stock`→`WH-Moh`, `MamP1/Stock`→`WH-MamP1`, `Tem1/2/3`→`WH-Tem1/2/3`, `ETW`→`WH-ETW`, `GR`→`WH-GR`, `IP`→`WH-IP`, `TAV`→`WH-TAV`, `TBL`→`WH-TBL`).

**Consequence:** the backfill (the roadmap's #1 risk) becomes a **direct seed from Odoo**, eliminating reconstruction guesswork.

---

## 3. The four decisions — resolved

**D1 — Transaction model.** Rewrite `pages/api/procurement/grn-confirm.ts` off the Neon shim (`createLoggedSql`) to `pg.Pool` via `@/lib/db-pool`, wrapping the per-line posting in `BEGIN/COMMIT` (rollback on any error). The shim issues each `await sql\`…\`` as a separate autocommit statement, so today a mid-loop failure already leaves partial stock. Atomicity is a prerequisite for "on-hand rises by exactly the accepted qty".

**D2 — `stock_quants` key → location-only (existing index kept).** Upsert `ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))`. `project_id` remains a descriptive nullable attribute, **not** in the uniqueness key. Rationale: the live unique index already chose this; a DC/warehouse holds unallocated stock; project attribution belongs on the movement ledger; Odoo itself keys on product×location, not project. The roadmap's "item × location × project" is read as "location-keyed, project-aware".

**D3 — `qty_available` → additive, not a cutover.** GRN confirm writes `stock_quants` + `field_stock_movements` **and keeps** its `qty_available` increment, all in one transaction. `stock_quants` becomes the new location-aware truth; `qty_available` stays the legacy global value with its existing readers/writers untouched. Create `v_stock_on_hand` (SUM of quants per item) as the eventual read model + reconciliation surface, but **do not flip readers or other writers** this sprint. The two balances are separate-but-reconciled, never summed together → no double-counting. The `qty_available`→derived cutover is deferred (it requires every mutator to route through quants — its own sub-project).

**D4 — Opening balance → seed from Odoo (GRN-replay rejected).** Pull current `stock.quant` (positive, internal locations) from Odoo, map product→`stock_item_id` and Odoo location→`stock_locations.id`, and upsert one opening `stock_quants` row + one opening `field_stock_movements` posting (Vendors → destination) per (item, location). Reconciles to Odoo by construction. Runs **dry-run → audit-log → `--commit`**.

---

## 4. Architecture & components

Five units, each independently understandable and testable.

### 4.1 `grn-confirm.ts` rewrite (go-forward write path)
- **Does:** On GRN confirm, in one transaction: insert the document-level `stock_movements` row (unchanged, kept as a higher-level reference), then for each accepted line — upsert `stock_quants` at the destination location, insert a `field_stock_movements` posting (`movement_type='receipt'`, `from_location_id`=Vendors, `to_location_id`=destination, `quantity`=accepted), and keep the existing `qty_available` increment. Set GRN `status='completed'`. Commit. On any error → rollback.
- **Interface:** `POST /api/procurement/grn-confirm` (unchanged request/response contract: `{ grnId, notes? }` → success payload). GL hook (`postGRNToGL`) and audit log preserved.
- **Depends on:** `@/lib/db-pool` (pg.Pool), the destination `location_id` (from `grn.warehouse_id`; see §6 note), the virtual Vendors location id.
- **Destination location:** for go-forward GRNs the destination is `grn.warehouse_id` (a real `stock_locations` FK chosen at GRN creation — the GRN/new picker already excludes virtual locations). This is independent of the historical FAULTY-default problem, which only affects the 325 *existing* completed GRNs (not re-posted).

### 4.2 Migration (schema + view + virtual location)
- **Virtual "Vendors" location:** insert a virtual `stock_locations` row to be the from-side of receipts. The `location_type` CHECK currently allows `warehouse/site_store/transit/technician/customer/scrap/adjustment` — **no `vendor`**. Decision: **add `vendor` to the CHECK** via migration (clearer than overloading `transit`), and insert `VENDORS` (`location_type='vendor'`, `is_virtual=true`), mirroring the existing virtual `ADJUST`/`SCRAP` pattern.
- **`v_stock_on_hand` view:** `SELECT stock_item_id, location_id, SUM(quantity) AS on_hand, SUM(reserved_quantity) AS reserved … GROUP BY stock_item_id, location_id` (plus an item-level rollup). Read-only; no readers flipped this sprint.
- **Migration version:** `MAX(version)=380` in the `migrations` table; a `381_create_garstfontein_dc.sql` file exists without a table row. **Next version = 382** — confirm against both `SELECT MAX(version)` and the highest `scripts/migrations/sql/` file at plan time (`feedback_migration_version_collision`). Include a `rollback_382_*.sql`.

### 4.3 Odoo opening-balance seed (`scripts/seed-stock-quants-from-odoo.ts`)
- **Does:** Authenticate to Odoo (creds from env / `odoo_api_config`, **never hardcoded**); read positive `stock.quant` at internal locations; resolve each line to (`stock_item_id` via `item_code`, `location_id` via location-code map); produce the full proposed quant + opening-movement set.
- **Modes:** `--dry-run` (default) prints a per-location and per-category total report + a mapping-gap report (unmatched products, unmapped locations), **writes nothing**; `--commit` upserts inside a transaction and writes a **row-level audit log** (one row per seeded quant with source, Odoo qty, resulting qty).
- **Idempotency:** safe to re-run — upsert on the existing unique key; opening movements tagged (`reference='ODOO_OPENING'`) so re-runs don't duplicate.
- **Location map:** explicit code→id table (no fuzzy matching); also persist it into `odoo_location_mappings` (currently empty) for reuse by the reconcile tool.
- **Depends on:** the migration (Vendors location) having run.

### 4.4 Odoo reconcile tool (`scripts/reconcile-stock-vs-odoo.ts`)
- **Does:** Pull live Odoo `stock.quant`, compare to FibreFlow `stock_quants` per (item, location), output a drift report (FibreFlow qty, Odoo qty, delta) sorted by absolute delta; summary totals.
- **Mode:** **read-only / report only** — never auto-corrects (auto-correct would make Odoo the SoT, contradicting the goal). Manually triggered; scheduling deferred.
- **Depends on:** the location map persisted by the seed.

### 4.5 `field_stock_movements` posting contract
- Columns verified: `stock_item_id` (NN), `movement_type` (NN; CHECK includes `receipt`), `from_location_id`/`to_location_id` (nullable), `quantity` (NN), `reference`, `unit_cost`/`total_cost`, full reversal columns. Receipts post `movement_type='receipt'`.

---

## 5. Data flow — the three acceptance flows

1. **Supplier → Central DC.** GRN with `warehouse_id`=Garstfontein DC → confirm → `stock_quants(DC)` += accepted; `field_stock_movements` receipt (Vendors→DC). DC on-hand rises by exactly the accepted qty.
2. **Supplier → Project (site store) directly.** GRN with `warehouse_id`=a site store → same posting at that location; bypasses the DC.
3. **Supplier → DC → Project.** Receive into DC (flow 1), then a DC→site-store transfer (a `transfer` movement debiting DC, crediting site store) — *transfer UI/endpoint is the next increment*; Sprint A delivers the receipt + posting primitives and the atomic quant mechanics the transfer will reuse. (Issue-into-custody + consume-against-drop are sub-projects C/D.)

> Sprint A scope note: flows 1 and 2 land end-to-end; flow 3's DC→Project **transfer** posting reuses the same `stock_quants`/`field_stock_movements` mechanics — included if it fits the sprint cleanly, else the immediate fast-follow. Issue/consume legs are explicitly out (C/D).

---

## 6. Odoo → FibreFlow mapping

- **Product:** Odoo `product.product.name` → FibreFlow `stock_items.item_code` (exact). Verified 139/140; the 1 miss ("Vendor Labour") is a non-stock service → skipped and reported.
- **Location:** explicit code map (Odoo `complete_name` token → FibreFlow `code`). Resolve the **`WH/Stock` → `WH-WH` vs `WH-MAIN` ambiguity** during the dry-run review with Hein. Non-physical Odoo internal locations (Transit/Output/Input/Vendors, if any of the 16) are excluded and listed.
- **Quantity:** Odoo `quantity` (on-hand) per line → `stock_quants.quantity`. (Odoo `reserved_quantity` not seeded in Sprint A.)

---

## 7. Error handling

- **GRN confirm:** all writes inside one `BEGIN/COMMIT`; any failure → `ROLLBACK` + `apiResponse.databaseError`; no partial stock. Log at the boundary (`@/lib/logger`), no silent catch.
- **Seed:** dry-run cannot mutate. `--commit` is transactional; a single line failure aborts the batch (no partial seed). Mapping gaps are warnings, not silent skips — surfaced in the report and audit log.
- **Reconcile:** read-only; Odoo auth/network failure → explicit error, no partial report claimed as complete.

---

## 8. Validation gates

- A GRN confirm raises destination `stock_quants` on-hand by **exactly** the accepted quantity (transactional test).
- Every receipt nets to zero across locations (Vendors debit = destination credit); no orphan quant lacking a movement.
- Opening seed: `SUM(stock_quants)` per (item, location) **equals Odoo `stock.quant`** for all mapped lines (reconcile-by-construction); mapping-gap report empty except known exclusions.
- `v_stock_on_hand` returns the seeded balances; reconcile tool reports near-zero drift immediately post-seed.
- `npm run ci:quick` + `tsc --noEmit` clean (against existing ratchets: 0 errors / 185 warnings / 43 pre-existing tsc errors — do not regress).

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Ongoing drift** — FibreFlow can't see outflows yet (C/D) | Odoo reconcile tool surfaces drift; hard cutover deferred until outflow capture proven |
| Seed double-write on re-run | Idempotent upsert on unique key; opening movements tagged `ODOO_OPENING` |
| `WH/Stock` location ambiguity | Resolved in dry-run review before `--commit` |
| Migration version collision (shared DB, parallel sessions) | `gh pr list --search 'migration in:title'` + MAX(version) at plan time (`feedback_parallel_session_migration_coordination`) |
| Hardcoded Odoo creds in `scripts/explore-odoo-inventory.js` | **Flag** (see §11); seed/reconcile read creds from env/`odoo_api_config` |
| Conditional-SQL shim breakage | N/A — new code uses `pg.Pool`, not the shim |

---

## 10. Rollback

- **Seed:** `DELETE FROM stock_quants` / `field_stock_movements WHERE reference='ODOO_OPENING'` (or the audited batch id). `stock_quants` starts at 0 rows, so the seed is fully reversible.
- **Migration:** `rollback_382_*.sql` drops the view, the Vendors row, and reverts the `location_type` CHECK.
- **`grn-confirm.ts`:** code-reversible via PR revert; `qty_available` path unchanged so reverting restores prior behaviour exactly.

---

## 11. Out of scope / deferred

- **Cron'd reconcile + drift alerting** (manual tool only this sprint; choose alert threshold after one real run).
- **`qty_available` → derived cutover** (requires routing every mutator through quants).
- **Outflow capture** (issues/consumption) and the **custody model** — sub-projects C/D.
- **DC→Project transfer UI** beyond the posting primitive (fast-follow if it doesn't fit cleanly).
- **Odoo `reserved_quantity`** seeding.
- **Security fix for hardcoded Odoo creds** in `scripts/explore-odoo-inventory.js` — flagged here; rotate + move to env in a separate hardening PR (the repo has prior credential-leak history — `feedback_no_credentials_in_plan_docs`).

---

## 12. Open items to resolve in the implementation plan

1. Confirm next migration version (MAX=380 + highest file; expect 382) and run the parallel-session collision check.
2. Lock the `WH/Stock` mapping target (dry-run review).
3. Confirm `grn-confirm.ts` stays <300 lines after the rewrite, or split the posting into a helper (`feedback_file_size_limit_strict`).
4. Decide whether flow-3 DC→Project transfer posting lands in Sprint A or as the immediate fast-follow.
