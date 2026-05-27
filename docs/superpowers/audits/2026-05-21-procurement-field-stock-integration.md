# Procurement ↔ Field-Stock Integration Audit

**Date**: 2026-05-21
**Author**: Claude (read-only audit)
**Scope**: Map the full stock lifecycle from PO → GRV → warehouse → field issue → consumption → return → restock → accountability → Odoo sync, to inform Phase 4 of the Field-Stock PWA.
**Status**: Read-only research. No code or schema modified.
**Source of authority**: live Supabase DB on Velocity (queried via `docker exec supabase-db psql -U postgres -d fibreflow`), code in `master @ 747695a23`, PRD-027 and PRD-050.

> **TL;DR — the single most important finding**:
> Two parallel `stock_movements`-style tables exist in the live DB. The **field-stock module's two main mutation handlers** (`pickings/process` and `returns/accept`) INSERT into the wrong one, using columns that don't exist. They have never raised data in production (every `done`/`restocked` row is missing from the audit trail). Phase 4 cannot ship without resolving this fork.

---

## 1. Page surface map

### 1.1 `pages/procurement/*` — main procurement UI (39 pages)

| Route | Purpose | Primary user |
|---|---|---|
| `/procurement` (`index.tsx`) | Procurement landing / KPIs | Manager, controller |
| `/procurement/workflow` | Procurement workflow wizard | Storeman, buyer |
| `/procurement/pipelines` | Threads = pipeline records, one per RFQ/PO sequence | Buyer |
| `/procurement/open-orders` | Combined active PRs + POs view | Manager |
| `/procurement/sourcing` (tabbed) | Suppliers / BOQ / RFQ | Buyer |
| `/procurement/purchasing` (tabbed) | Requisitions / Quotes / POs / GRN | Buyer |
| `/procurement/inventory` (tabbed) | Stock / Items / Categories / Bundles / Takes / **Field** | Storeman |
| `/procurement/financial` (tabbed) | Budget / Cost Centers | Manager, controller |
| `/procurement/requisitions/{index,new,[id]}` | Purchase requisition CRUD | Site, buyer |
| `/procurement/boq/{index,new,[id]}` | BOQ import + lines | Project planner |
| `/procurement/rfq/{index,new,[id]}` | RFQ to suppliers | Buyer |
| `/procurement/quotes` | Quote evaluation & comparison | Buyer, manager |
| `/procurement/purchase-orders/{index,new,[id]}` | PO CRUD | Buyer, manager |
| `/procurement/grn/{index,new,[id]}` | Goods Receipt Note CRUD | Storeman (receiving) |
| `/procurement/approvals` | All approval statuses + filtering | Manager (approver) |
| `/procurement/budget` | Project budget templates dashboard | Manager, controller |
| `/procurement/cost-centers` | Hierarchical cost centers | Controller |
| `/procurement/stock` | Stock positions / movements / alerts | Storeman |
| `/procurement/stock-items` | Stock item master | Storeman |
| `/procurement/stock-categories` | Category hierarchy | Storeman |
| `/procurement/stock-takes/{index,[id]}` | Stock take execution + variance | Storeman |
| `/procurement/bundles` | Stock kits/bundles | Storeman |
| `/procurement/reports/{index,bootstock}` | Procurement reports + boot-stock report | Manager |
| `/procurement/audit` | Full audit trail browser | Auditor |
| `/procurement/field-stock/index` | **Field-stock control hub (tabbed)** | Storeman |
| `/procurement/field-stock/reconciliation` | Stage-4 daily reconciliation | Storeman, manager |
| `/procurement/field-stock/pickings/[pickingId]` | Single picking detail / actions | Storeman, manager |

The `field-stock/index.tsx` page has 9 tabs (dashboard, locations, serials, consumptions, pickings, returns, accountability, faults, adjustments) — evidence: `pages/procurement/field-stock/index.tsx:45`.

### 1.2 `pages/procurement/field-stock/*` — field-stock module pages

Listed in 1.1 (3 files). All under `/procurement/field-stock/`.

### 1.3 `pages/my/stores/*` — Phase 3/4 PWA

**Does not exist on master HEAD** (`747695a23`). `pages/my/` only contains:

- `pages/my/index.tsx`
- `pages/my/onboard.tsx`
- `pages/my/attendance/{clock,history,corrections,corrections/new}.tsx`
- `pages/my/receipts/{index,new,[id]}.tsx`
- `pages/my/payslips/index.tsx`

No `stores/` subtree yet. The Phase 3 design doc referenced in the prompt (`docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md`) and PR #1678 are **not in this branch**. The Phase 4 spec will create both `pages/my/stores/` and likely `pages/api/my/stores/`.

---

## 2. API endpoint inventory

### 2.1 `pages/api/procurement/*` (excluding `field-stock/`) — 96 endpoints

> Full list in `find pages/api/procurement -type f`. Verb is GET unless noted; many files multiplex GET/POST/PUT/DELETE inside the handler.

**Catalogue & masters**

| Endpoint | Methods | Purpose |
|---|---|---|
| `stock-items.ts` | GET, POST | Stock item master list |
| `stock-items-search.ts` | GET | Search stock items by code/name |
| `stock-categories.ts` | GET | Category hierarchy |
| `categories/{index,[id]}.ts` | GET, POST, PATCH, DELETE | Procurement category CRUD (separate from stock_categories) |
| `cost-centers/{index,[id]}.ts` | CRUD | Cost-center CRUD |
| `cost-centers/types.ts` | GET | Cost-center type enum |
| `cost-centers/[id]/allocations.ts` | GET, POST | Cost-center allocations |
| `cost-centers/[id]/transactions.ts` | GET | Cost-center transaction history |
| `supplier-item-codes.ts` | GET | Map supplier item code → stock item |

**BOQ (Bill of Quantities) — 12 endpoints**

| Endpoint | Purpose |
|---|---|
| `boq/index.ts` | List BOQs |
| `boq/[id].ts` | BOQ detail |
| `boq/import-mapped.ts` | Import with manual mapping |
| `boq/import-enhanced.ts` | Import with AI mapping |
| `boq/detect-columns.ts` | Auto-detect Excel columns |
| `boq/map-stock-item.ts` | Manually map BOQ line → stock_item |
| `boq/rematch-stock.ts` | Re-run match against stock items |
| `boq/update-items.ts` | Bulk update BOQ lines |
| `boq/rollback.ts` | Rollback to prior version |
| `boq/versions.ts` | List versions |
| `boq/compare-versions.ts` | Diff versions |
| `boq/change-history.ts` | Per-line change log |
| `boq/templates.ts` | Column-mapping templates |
| `boq-lifecycle.ts` | High-level BOQ → PO → GRN status |
| `boq-spend-summary.ts` | Spend by BOQ line |
| `boq-stock-view.ts` | BOQ items joined to stock_quants |

**RFQ → Quote → PO flow**

| Endpoint | Purpose |
|---|---|
| `requisitions/{index,[id]}.ts` | Purchase requisition CRUD |
| `requisitions-export.ts` | Export PRs to Excel |
| `rfq/index.ts` + `rfq/[id]/{index,convert-to-po}.ts` | RFQ list, detail, convert |
| `rfq-suppliers.ts` | Supplier list for RFQ creation |
| `quotes/{extract-from-document,create-from-extraction}.ts` | PDF extraction → quote |
| `quote-evaluations.ts` | Score quotes |
| `purchase-orders/{index,[id]}.ts` | PO CRUD |
| `purchase-orders-export.ts` | Export POs to Excel |
| `purchase-orders-approval.ts` | PO approval triggers |
| `open-orders.ts` + `open-orders-export.ts` | Aggregated open orders |

**GRN (Goods Receipt Note)**

| Endpoint | Purpose |
|---|---|
| `grn/index.ts` | List GRNs |
| `grn/[id].ts` | GRN detail |
| `grn/available-pos.ts` | POs eligible for a new GRN |
| `grn-confirm.ts` | **Confirm GRN → creates `stock_movements` + `stock_movement_items` rows** (line 87, 144) |
| `grn-export.ts` | Export GRNs to Excel |
| `grn/[id]/register-assets.ts` | **Register GRN serials as `assets` (NOT `stock_serials`)** |

**Approvals & history**

| Endpoint | Purpose |
|---|---|
| `approvals/{pending,all}.ts` | Approval queues |
| `approvals/[id]/{approve,reject,park,resume}.ts` | Approval actions |
| `audit-logs/index.ts` | Audit log browser |
| `payment-requests.ts` | Payment request CRUD |
| `documents.ts` | Attachments |

**Bundles & stock takes**

| Endpoint | Purpose |
|---|---|
| `bundles/{index,[id]}.ts` + `bundles/[id]/items/{index,[itemId]}.ts` | Bundle CRUD |
| `bundles/reports/{cost-analysis,consumption,usage,inventory-value}.ts` | Bundle analytics |
| `stock-takes/{index,[id]}.ts` + `stock-takes/[id]/actions.ts` | Stock take CRUD + actions |
| `stock-takes/reasons.ts` | Variance reason enum |

**SOH audit / adjustments / misc**

| Endpoint | Purpose |
|---|---|
| `soh-audit/{template,versions,warehouses,import}.ts` | Stock-on-hand audit import |
| `adjustments/index.ts` | Manual stock adjustments — uses `field_stock_movements` (grep confirmed) |
| `fault-reports/{index,[faultId],analytics}.ts` | Fault reporting |
| `stock/index.ts` | Aggregated stock view |
| `aggregate-metrics.ts`, `metrics/aggregate.ts` | **DUPLICATE-LOOKING** procurement KPI aggregators |
| `reports-data.ts` | Reports data source |
| `tab-badges.ts` | Tab badge counters |
| `spend-by-supplier-export.ts` | Supplier spend Excel |
| `projects/summaries.ts` | Per-project procurement summary |
| `threads/{index,[id]}.ts` | Pipeline threads |

⚠ **Duplicates / parallel endpoints to flag**:
- `aggregate-metrics.ts` vs `metrics/aggregate.ts` — likely overlapping, needs reconciliation.
- `stock-items.ts` (procurement) vs `pages/api/stock-items/{index,[itemId]}.ts` (root) — root-level is the older Odoo-shim version; procurement is the newer pattern.

### 2.2 `pages/api/procurement/field-stock/*` — 27 endpoints

| Endpoint | Methods | Purpose |
|---|---|---|
| `dashboard.ts` | GET | Field-stock summary KPIs |
| `locations.ts` + `locations/[locationId].ts` | CRUD | Stock location CRUD |
| `items.ts` | GET, POST | Items list (read of `stock_items`) |
| `serials.ts` | GET, POST | List + register serials |
| `serials/[serialNumber].ts` | GET | Serial detail by number |
| `serials/transition.ts` | POST | State-machine transition (`serialStateMachine.ts`) |
| `import-serials.ts` | POST | Bulk import serials from Excel |
| `export-serials.ts` | GET | Excel export |
| `serial-recon.ts` | GET | Serial reconciliation report |
| `consumptions.ts` | GET, POST | Consumption list + record |
| `consumptions/[consumptionId]/verify.ts` | POST | Verify consumption |
| `pickings/index.ts` | GET, POST | Picking list + create |
| `pickings/[pickingId]/index.ts` | GET, PATCH | Picking detail |
| `pickings/[pickingId]/confirm.ts` | POST | Draft → confirmed |
| `pickings/[pickingId]/cancel.ts` | POST | Cancel |
| `pickings/[pickingId]/sign.ts` | POST | Capture digital signature |
| **`pickings/[pickingId]/process.ts`** | POST | **Confirmed → done; mutates quants + serials; writes `stock_movements` (BROKEN)** |
| `returns/index.ts` | GET, POST | Returns list + create |
| `returns/[returnId]/inspect.ts` | POST | Inspect return lines |
| **`returns/[returnId]/accept.ts`** | POST | **Inspected → restocked; mutates quants + serials; writes `stock_movements` (BROKEN)** |
| `movements/[movementId]/reverse.ts` | POST | Reverse a movement (uses `field_stock_movements`) |
| `accountability/index.ts` | GET | Contractor accountability list |
| `accountability/[contractorId]/index.ts` | GET | Per-contractor detail |
| `accountability/[contractorId]/block.ts` | POST | Block contractor |
| `accountability/[contractorId]/unblock.ts` | POST | Unblock contractor |
| `accountability/[contractorId]/reconcile.ts` | POST | Manual reconciliation |

### 2.3 Odoo sync endpoints

| Endpoint | Purpose |
|---|---|
| `pages/api/odoo/sync/stock-movements.ts` | HTTP trigger for the Odoo stock-picking sync |

Scripts:
- `scripts/odoo-sync-stock-movements.ts` — pulls Odoo pickings into `stock_movements` (project-based)
- `scripts/odoo-sync-remaining.ts` — backfill helper

---

## 3. Schema map — who writes what

> Evidence is `\d <table>` against the live DB (Velocity supabase-db) for current schema, and `grep -l "INSERT INTO <table>"` for writers.

### 3.1 Procurement-owned tables

| Table | Source-of-truth module | Primary writers | Primary readers | FK glue |
|---|---|---|---|---|
| `suppliers` | procurement | manual + Odoo `supplierSync` | RFQ, PO, GRN, invoices | id INT (NOT uuid) |
| `purchase_requisitions` + `_items` | procurement | `requisitions/{index,[id]}` | `rfq/[id]/convert-to-po`, `open-orders` | PR → RFQ → quote → PO |
| `rfqs` + `rfq_items`, `rfq_suppliers`, `rfq_responses`, `rfq_response_items`, `rfq_evaluation_criteria`, `rfq_evaluation_scores`, `rfq_notifications` | procurement | `rfq/*` | quote evaluation | rfq_id |
| `quotes` + `quote_items`, `quote_documents`, `quote_extractions`, `quote_extraction_items` | procurement | `quotes/*` | `rfq/[id]/convert-to-po` | quote_id |
| `purchase_orders` + `purchase_order_items` | procurement | `purchase-orders/{index,[id]}`, `rfq/[id]/convert-to-po` | GRN, payments | po_id → po_item_id ← grn_item.po_item_id |
| `purchase_order_history`, `purchase_order_versions` | procurement | trigger from `purchase_orders` | audit | po_id |
| `client_purchase_orders` | procurement | manual | customer billing | separate from `purchase_orders` |
| `goods_receipt_notes` + `goods_receipt_items` | procurement | `grn/{index,[id]}`, `grn-confirm` | `register-assets`, `stock_movements` audit | grn_id, po_item_id |
| `supplier_invoices` (referenced in PRD-050; **not present in live `\dt` listing** — only `sage_supplier_invoices` exists) | procurement | sage sync | 3-way match | — |
| `sage_supplier_invoices`, `sage_customer_invoices`, `customer_invoices`, `customer_invoice_items`, `customer_quotes`, `customer_quote_lines`, `recurring_invoices` | procurement (sage) | sage sync | billing | sage_id |
| `boqs` + `boq_items`, `boq_revisions`, `boq_approvals`, `boq_change_log`, `boq_exceptions`, `boq_import_exceptions`, `boq_category_mapping`, `boq_column_templates`, `boq_rfq_links`, `boq_rfq_item_mapping` | procurement | `boq/*` | RFQ, PO | boq_id |
| `stock_movements` (**procurement variant** — project-based, Odoo-aware) | procurement | `grn-confirm`, `odoo-sync-stock-movements`, `stockMovementSync` | reporting | `project_id` (varchar), `odoo_picking_id`, `bundle_id` |
| `stock_movement_items` | procurement | `grn-confirm` | reporting | `stock_movement_id` FK to `stock_movements` |
| `stock_bundles` + `stock_bundle_items` | procurement | `bundles/*` | bundles dashboard | bundle_id |
| `stock_takes` + `stock_take_lines`, `stock_take_adjustments` | procurement | `stock-takes/*` | reconciliation | stock_take_id |
| `stock_categories`, `stock_levels`, `stock_positions` | procurement | various | dashboards | — |
| `stock_adjustment_reasons` | procurement | seed only | adjustments | — |
| `payment_requests`, `recurring_invoices` | procurement | manual | finance | — |
| `quote_documents`, `purchase_order_versions` | procurement | trigger | audit | — |

### 3.2 Field-stock-owned tables (migrations 027–031, 107, 312)

| Table | Source-of-truth module | Primary writers | Primary readers | FK glue |
|---|---|---|---|---|
| `stock_items` | **SHARED** (procurement masters, field-stock reads) | procurement seeds; manual via `stock-items.ts` | both modules | `item_code` UNIQUE |
| `stock_locations` | field-stock | `field-stock/locations.ts` | both modules; PO `warehouse_id` references it | hierarchical (parent_id) |
| `stock_serials` | field-stock | `field-stock/serials.ts`, `import-serials.ts`, `serialService.ts` | both modules; consumption | `stock_item_id`, `current_location_id`, `installed_at_drop_id` |
| `stock_quants` | field-stock | `pickings/process`, `returns/accept`, GRN trigger (mig 051) | dashboards | unique on (stock_item_id, location_id, lot_number) |
| `stock_pickings` + `stock_picking_lines` | field-stock | `pickings/*` | accountability trigger | `picking_id`, `source_location_id`, `destination_location_id` |
| `stock_consumptions` | field-stock | `consumptions.ts`, `consumptions/[id]/verify.ts` | accountability rollup | `drop_id`, `drop_number`, `picking_id`, `serial_id` |
| **`field_stock_movements`** | field-stock | `adjustments/index.ts`, `stock-takes/[id]/actions.ts`, `movements/[id]/reverse.ts`, `serialStateMachine.ts`, `serialService.ts`, `consumptionService.ts` | audit, reversal | mirrors mig 028 schema, FK to pickings/consumptions/serials/locations |
| `stock_returns` + `stock_return_lines` | field-stock | `returns/{index,inspect,accept}` | accountability (NOT yet wired) | `original_picking_id`, `return_id` |
| `contractor_stock_accountability` | field-stock | trigger `trg_update_accountability_on_issue` (only fires on **issue**) + `accountability/*` manual reconcile | dashboard, blocking checks | `contractor_id` UNIQUE |
| `stock_accountability_history` | field-stock | accountability trigger + reconcile endpoints | audit | `contractor_id`, `reference_id` |
| `odoo_stock_picking_states` | field-stock/Odoo | Odoo sync | reconciliation | `odoo_picking_id` |

### 3.3 Assets (parallel serial tracking)

| Table | Source-of-truth module | Primary writers | Primary readers | FK glue |
|---|---|---|---|---|
| `assets`, `asset_categories`, `asset_alerts`, `asset_assignments`, `asset_documents`, `asset_maintenance`, `asset_registration_batches` | assets module (procurement-adjacent) | `grn/[id]/register-assets` → `assetRegistrationService.batchRegisterFromGrn` | asset register UI | `serial_number`, `grn_item_id` |
| `asset_category_stock_mapping` | assets | seed | bridge to `stock_items` | — |

⚠ **Critical schema split**: GRN serial registration writes to **`assets`** (with `serial_number TEXT`), not to **`stock_serials`** (with `serial_number VARCHAR(100)` + `stock_item_id` FK). The same serial may end up in both, or in only one, with no enforced join. See §5 for the lifecycle gap.

### 3.4 Contractor-side tables

| Table | Primary writers | Primary readers |
|---|---|---|
| `contractors` | contractor module | accountability, pickings (contractor_id FK) |
| `contractor_agreements`, `contractor_directors`, `contractor_documents`, `contractor_file_storage`, `contractor_invoices`, `contractor_onboarding_stages`, `contractor_payments`, `contractor_progress_claims`, `contractor_projects`, `contractor_rag_history`, `contractor_teams`, `contractor_verifications` | contractor admin | contractor dashboards |
| `drops_contractors` | drops module | contractor allocation |
| `hs_contractor_compliance` | HSE | compliance reports |

---

## 4. Lifecycle trace — one ONT, end to end

Example: 100 × Huawei ONT HG8546M ordered, GRV'd, allocated, issued, installed.

### Step 1 — PO raised

- Code: `pages/api/procurement/purchase-orders/index.ts` (POST) or `rfq/[id]/convert-to-po.ts`.
- Writes: `purchase_orders` + `purchase_order_items` rows.
- Status flow: `draft → pending_approval → approved → sent → acknowledged → partially_received → received → invoiced → paid` (see mig 050, line 34).
- `purchase_order_items.stock_item_id` → links to `stock_items` (Huawei ONT row in the seed; `item_code='ONT-HUAWEI-HG8546M'`).
- `purchase_orders.warehouse_id` → `stock_locations(id)`.

### Step 2 — GRV received

- Code: `pages/api/procurement/grn/{index,[id]}.ts` for header, then `grn-confirm.ts` to finalise.
- Writes: `goods_receipt_notes` + `goods_receipt_items`.
- **Trigger `process_grn_stock_update`** (mig 051, line 269) — runs on `goods_receipt_notes.status → 'completed'`. It:
  1. Upserts `stock_quants` (item × warehouse).
  2. Inserts a `stock_movements` row. **The trigger uses the OLD column set (`reference_type, reference_id, stock_item_id, to_location_id, lot_number, created_by`)**, which **does not match the current `stock_movements` schema** in the live DB (which has `project_id NOT NULL`, `reference_number NOT NULL`, `movement_date NOT NULL`, no `stock_item_id`, no `to_location_id`, no `lot_number`, no `created_by`). The trigger will fail with column-not-found.

    **Verification**: `stock_movements` had 341 rows, last write `2026-02-19`. `purchase_orders` has 498 rows, `goods_receipt_notes` has 325 rows. The trigger has clearly not run successfully for recent GRNs. (The function still exists; it just errors out silently. The `grn-confirm.ts` API does its own correct INSERT into `stock_movements` + `stock_movement_items` instead, line 87+144.)

- **`grn-confirm.ts` (line 87)**: Inserts ONE `stock_movements` row per GRN with `project_id='fibreflow'`, `movement_type='GRN'`, `reference_number=grn_number`, and per-line `stock_movement_items` rows. **This is the path that actually writes the procurement audit trail.**
- **GRN does NOT auto-populate `stock_serials`**. Serials only enter the field-stock registry through:
  - `pages/api/procurement/grn/[id]/register-assets.ts` → writes `assets`, NOT `stock_serials`.
  - `pages/api/procurement/field-stock/import-serials.ts` → bulk Excel import to `stock_serials`.
  - `pages/api/procurement/field-stock/serials.ts` (POST) → manual one-by-one via `serialService.registerSerial` (`src/modules/procurement/field-stock/services/serialService.ts:170`).

### Step 3 — serials at warehouse

- `stock_serials.current_location_id = warehouse` and `status='available'`.
- `stock_quants` row should exist for (item, warehouse) — but currently `SELECT COUNT(*) FROM stock_quants = 0` in the live DB, despite 36,264 serials. **Stock_quants is effectively unused / not maintained.**

### Step 4 — field-stock allocation to project/warehouse

- There is **no explicit "allocation" endpoint** that ties a `stock_quants` row to a `project_id`. `stock_quants.project_id` is nullable and not written by any of the production code paths I traced.
- The closest concept is the *picking* itself: `stock_pickings.project_id` is set on issue.
- The "Stores Today" notion of "stock allocated to project X" is **not modelled in the schema**; it can only be derived from `(stock_serials.current_location_id → location whose `project_id` matches)`.

### Step 5 — issue picking to tech

- Code: `pages/api/procurement/field-stock/pickings/index.ts` (POST creates draft) → `confirm.ts` → **`process.ts`**.
- `process.ts` (mig 028 schema):
  1. `BEGIN` transaction (line 80).
  2. `SELECT ... FOR UPDATE` to lock `stock_quants` rows (line 41).
  3. Validates availability (line 56).
  4. Updates source `stock_quants.quantity -=` (line 144).
  5. Upserts destination `stock_quants` (line 154).
  6. For serial-tracked items: `UPDATE stock_serials SET current_location_id, status='issued'` (line 167).
  7. **`INSERT INTO stock_movements (picking_id, stock_item_id, movement_type, from_location_id, to_location_id, quantity, performed_at)`** (line 181) — **THIS INSERT TARGETS THE WRONG TABLE.** None of those columns exist on the live `stock_movements`. It should target `field_stock_movements`. The transaction will ROLLBACK with a column error every time a picking is processed.

    **Verification**: `SELECT COUNT(*) FROM stock_pickings WHERE status='done' = 0` (live DB). Five pickings exist (1 draft, 1 confirmed, 3 cancelled). **No picking has ever been processed successfully in production.** This is the smoking gun.

### Step 6 — tech consumes serial at drop install

- Code: `pages/api/procurement/field-stock/consumptions.ts` (POST) → `consumptionService.recordConsumption()`.
- Writes: `stock_consumptions` (with `drop_number`, `drop_id`, `serial_id`, `consumed_by_id`, GPS), and updates `stock_serials.status='installed', installed_at_drop_*`.
- `consumptionService.ts` also INSERTS into `field_stock_movements` (correct table).
- `qa_photo_reviews` (WhatsApp QA) — separate channel that ALSO records ONT serial against a DR number. See `feedback_qa_standards.md`. **These two paths can disagree** (`stock_consumptions` vs `qa_photo_reviews.ont_serial`).

  **Verification**: `SELECT COUNT(*) FROM stock_consumptions = 0` (live DB). `SELECT COUNT(*) FROM stock_serials WHERE installed_at_drop_id IS NOT NULL = 0`. **No consumption has ever been recorded through the official endpoint.** Production installation data lives in `qa_photo_reviews.ont_serial` and `qfield_*` tables instead, never propagated to `stock_serials.status='installed'`.

### Step 7 — tech returns serial

- Code: `returns/index.ts` (POST creates) → `returns/[returnId]/inspect.ts` → **`returns/[returnId]/accept.ts`**.
- `accept.ts` per-line behaviour by `disposition`:
  - `restock` → upsert `stock_quants` at `return_to_location_id`; set serial `status='available'`.
  - `scrap` → set serial `status='scrapped'`.
  - `repair` → set serial `status='faulty'`.
- Then **`INSERT INTO stock_movements (stock_item_id, movement_type='return', to_location_id, quantity, notes, performed_at)`** — **same bug as §step 5**. Wrong table; will fail. **No transaction wrapping** (compare with `process.ts` which has `BEGIN/COMMIT`).
- Sets `stock_returns.status='restocked'`.

  **Verification**: `SELECT COUNT(*) FROM stock_returns = 0` (live DB). Never exercised in production.

### Step 8 — contractor accountability rollup

- Trigger `trg_update_accountability_on_issue` (mig 029, line 232) — fires on `stock_pickings` AFTER UPDATE WHEN `status → 'done'`.
  - Inserts/ensures `contractor_stock_accountability` row.
  - Inserts `stock_accountability_history` event_type='issue'.
  - **Does NOT update any counters** (`total_issued_count`, `unaccounted_count`, etc. — all stay at 0). The trigger body is incomplete; it only writes the audit row, not the rollup.
- **No trigger on `stock_returns`** (PRD-027 §10 calls for one; gap confirmed). `\d stock_returns` shows zero triggers.
- **No trigger on `stock_consumptions`** either — so even successful consumption can't update `total_consumed_count`.
- Manual rollup endpoint: `accountability/[contractorId]/reconcile.ts` — must be invoked manually.

### Step 9 — Odoo sync

- Pull (Odoo → FF): `scripts/odoo-sync-stock-movements.ts` calls `stockMovementSync.ts`. Inserts into `stock_movements` (line 248) with the project-based schema: `project_id='odoo'`, `source_type='odoo'`, `odoo_picking_id`. Then `syncMoveItem()` inserts into `stock_movement_items`.
- Push (FF → Odoo): I found no explicit push code in the audit. The integration is read-only from Odoo's perspective except where `grn-confirm.ts` writes a local mirror record that the Odoo sync **does not push back** (it filters on `odoo_picking_id IS NOT NULL`).
- The Odoo sync **does NOT touch `field_stock_movements`, `stock_pickings`, `stock_returns`, `stock_serials`, or `stock_quants`** — it lives entirely in the procurement-side `stock_movements` table.

---

## 5. Known broken integrations (verified)

| # | Bug | Where | Evidence |
|---|---|---|---|
| **A** | `process.ts` INSERTs into `stock_movements` with `picking_id, stock_item_id, from_location_id, to_location_id, performed_at` — none of these columns exist on live `stock_movements` | `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts:181` | `\d stock_movements` shows project-based schema; `\d field_stock_movements` matches the columns being used. Live: `stock_pickings.status='done' COUNT = 0` |
| **B** | `accept.ts` INSERTs into `stock_movements` with the same wrong column set, AND has no `BEGIN/COMMIT` wrap | `pages/api/procurement/field-stock/returns/[returnId]/accept.ts:124` | Same `\d` evidence; live `stock_returns COUNT = 0` |
| **C** | Migration 051 trigger `process_grn_stock_update` references columns that don't exist on current `stock_movements` (`reference_type, reference_id, stock_item_id, to_location_id, lot_number, created_by`) | `scripts/migrations/051_goods_receipt_notes.sql:269` | Trigger is still defined in DB; `stock_movements` last write 2026-02-19 even though 325 GRNs exist (most created since). `grn-confirm.ts` does the INSERT correctly so the trigger failure is invisible. |
| **D** | No trigger on `stock_returns` to roll up `contractor_stock_accountability` (PRD-027 §10) | `\d stock_returns` shows zero triggers | Issue trigger exists only on `stock_pickings` (mig 029 line 232). |
| **E** | Trigger `update_accountability_on_issue` writes the `stock_accountability_history` event row but **does not update counters** on `contractor_stock_accountability` (the totals stay at zero) | `scripts/migrations/029_field_stock_returns.sql:206-228` | Trigger body has no `UPDATE contractor_stock_accountability SET total_issued_count =` statement. |
| **F** | `stock_consumptions` has no accountability trigger — successful consumption can't move `total_consumed_count` | `\d stock_consumptions` shows zero triggers | Phase 4 will need to add it. |
| **G** | `stock_quants` table is empty (0 rows) despite the system claiming to track quants — `process.ts` and `accept.ts` would upsert quants, but those handlers never succeed (bugs A, B). The empty quants table means `dashboard.ts` low-stock alerts (line 99) always return 0 | live `SELECT COUNT(*) FROM stock_quants = 0` | All low-stock telemetry currently lies. |
| **H** | GRN serial registration creates `assets`, not `stock_serials`. Field-stock module manages `stock_serials` (36,264 rows from Excel imports + manual entry). The two registries are disjoint with no enforced join. | `pages/api/procurement/grn/[id]/register-assets.ts:119` → `assetRegistrationService.batchRegisterFromGrn` → `assets` table (NOT `stock_serials`) | A serial received via GRN appears in `assets` only; a serial swap recorded via `stock_serials` is invisible to the asset register. |
| **I** | `stock_pickings.status='done'` has NO transition on `stock_serials.installed_at_drop_*` — that field is populated only by `stock_consumptions` and (now) the WA QA path. So a tech issued an ONT (`status='issued'`) but the install record lives in `qa_photo_reviews`; the field-stock module shows the serial as "still issued" forever. | live `stock_serials WHERE installed_at_drop_id IS NOT NULL COUNT = 0` despite years of installs | Phase 3/4 must reconcile WA-QA ONT serial → `stock_serials.installed_at_drop_*`. |
| **J** | `pages/api/procurement/field-stock/movements/[movementId]/reverse.ts` operates on `field_stock_movements`, while the procurement-side `stock_movements` has its own `is_reversed/reversed_by/reversed_at/original_movement_id` columns and **no reverse endpoint**. So reversing a GRN-driven movement is not exposed by any API. | grep + `\d stock_movements` | Operational gap. |
| **K** | Two parallel KPI endpoints: `aggregate-metrics.ts` and `metrics/aggregate.ts` | `pages/api/procurement/*` | Risk of inconsistent numbers across UI pages. |

---

## 6. Odoo bridge

### What exists

| Component | Location | Role |
|---|---|---|
| `OdooClient` | `src/services/odoo/odooClient.ts` | XML-RPC client (single instance, hard-coded creds in scripts — **flag for secret rotation**) |
| `stockMovementSync` | `src/services/odoo/entities/stockMovementSync.ts` | Pulls `stock.picking` + `stock.move` from Odoo → `stock_movements` + `stock_movement_items`. 390 lines. |
| `stockTransferSync` | `src/services/odoo/entities/stockTransferSync.ts` | Internal-location transfers |
| `stockReceiptSync` | `src/services/odoo/entities/stockReceiptSync.ts` | Goods receipts |
| `stockLevelSync` | `src/services/odoo/entities/stockLevelSync.ts` | Quantities on hand |
| `purchaseOrderSync` | `src/services/odoo/entities/purchaseOrderSync.ts` | POs |
| `supplierSync`, `productSync`, `assetSync`, `fleetSync`, `attachmentSync` | same dir | Masters + adjacent |
| Trigger script | `scripts/odoo-sync-stock-movements.ts` | Cron entry-point |
| HTTP trigger | `pages/api/odoo/sync/stock-movements.ts` | Manual run |
| Migration 116 | `scripts/migrations/116_odoo_inventory_sync.sql` | Adds `odoo_*` columns to `stock_movements`; creates `odoo_stock_picking_states` |
| `odoo_stock_picking_states` | live table | Mirrors Odoo state per picking |
| `sage_supplier_invoices`, `sage_customer_invoices` | tables | **Note: Sage is a SEPARATE financial sync, not Odoo** |

### What it does

- Source-of-truth direction: **Odoo → FibreFlow** for warehouse movements. `stock_movements.odoo_picking_id IS NOT NULL` rows are imported; rows from `grn-confirm.ts` have `source_type='fibreflow'` and `odoo_picking_id IS NULL` — they are **not pushed back to Odoo**.
- The Odoo sync ignores `field_stock_movements`, `stock_pickings`, `stock_returns`, `stock_serials`, and `stock_quants` entirely.

### Currently active?

- Last write to `stock_movements`: **2026-02-19** (over 3 months ago). Sync likely stopped or paused. **Phase 4 should treat the Odoo sync as effectively inactive** unless the controller confirms otherwise.
- `feedback_environment_sync.md` / `project_field_stock_pwa.md` memory does not mention an active Odoo sync as of 2026-05-19.

### What field-stock would need to integrate

If Odoo sync is reactivated:
1. Field-stock issues/returns/consumptions written to `field_stock_movements` would need a one-way mirror to `stock_movements` with `source_type='fibreflow'`, `project_id`, and `reference_number`.
2. Or Phase 4 unifies the two `_movements` tables. See §8 OQ-4.

---

## 7. "Stores Today" candidate data sources

Existing views and aggregations that compute "issued today / returns today / consumption today" or similar:

| View / endpoint | Live? | What it gives |
|---|---|---|
| `v_field_stock_movements` (view) | yes | Joins `stock_pickings → stock_picking_lines → stock_items` with location names. Source of "all movements" feed. **Note: built on `stock_pickings`, not on `field_stock_movements` despite the name.** |
| `v_technician_stock_summary` (view) | yes | Per-technician stock-on-hand cross-join (`stock_locations[type='technician'] × stock_items LEFT JOIN stock_quants`). Returns one row per (tech, item). Cardinality concern — `36k serials × N techs` would be expensive. |
| `v_technician_field_dashboard` (view) | yes | Technician field activity rollup (need to inspect) |
| `v_installation_stock_reconciliation` (view) | yes | Issued vs installed vs returned per technician (Stage-4 reconciliation source — see `src/modules/field-stock/services/reconciliationService.ts`) |
| `v_procurement_lineage` (view) | yes | PR → RFQ → quote → PO → GRN lineage |
| `v_qfield_oes_activations` (view) | yes | Activation source (cross-module) |
| `v_stock_bundle_items_detail`, `v_stock_bundles_summary` | yes | Bundles |
| `v_stock_categories_tree` | yes | Category tree |
| `v_stock_take_lines_detail`, `v_stock_takes_summary` | yes | Stock take roll-ups |
| `pages/api/procurement/field-stock/dashboard.ts` | yes | Single endpoint with `consumptions.today / .thisWeek / .unverified`, `serials.byStatus`, low-stock count |
| `pages/api/field-stock/reports/daily-reconciliation` (referenced in `src/modules/field-stock/.claude.md`) | needs verification | Stage-4 daily reconciliation per technician |
| `pages/api/procurement/aggregate-metrics.ts` + `metrics/aggregate.ts` | yes | Procurement-wide KPIs |
| `pages/api/procurement/projects/summaries.ts` | yes | Per-project procurement summary |
| `pages/api/procurement/field-stock/serial-recon.ts` | yes | Serial reconciliation report |

Recommended Phase 4 sources for "Stores Today":
- `v_installation_stock_reconciliation` for the Stage-4 rollup (already proven for Daily Reconciliation).
- `v_field_stock_movements` filtered to `effective_date::date = CURRENT_DATE` for issues today.
- A NEW view for returns-today / consumptions-today — none exists.

⚠ Avoid `v_technician_stock_summary` for live dashboards — cross-join risk.

---

## 8. Open questions for the controller (Phase 4 spec inputs)

1. **OQ-1 Two `_movements` tables**: keep `stock_movements` (project/Odoo-aware) and `field_stock_movements` (field-stock audit) separate, or unify? If keep separate, define which writes to which (today the rule is implicit and Phase 3 violated it). PRD-027 calls for a single audit trail.

2. **OQ-2 Two serial registries**: `assets` (procurement, GRN-created) vs `stock_serials` (field-stock, Excel-import-created). Same physical serial can exist in both with no FK. Phase 4 decision: enforce single-source (probably `stock_serials`, with `assets.stock_serial_id` FK) or accept the split and document the join keys?

3. **OQ-3 GRN → stock_serials gap**: should the GRN confirmation step auto-create `stock_serials` rows for serial-tracked `goods_receipt_items.serial_numbers[]`, so warehouse stock is queryable immediately rather than waiting for an Excel re-import? (Currently the serials arrive via `import-serials.ts` after the fact.)

4. **OQ-4 `received` intermediate state**: PRD-027 §6 state machine says `pending → received → inspected → accepted → restocked` for returns. The current `inspect.ts` writes `status='inspected'` straight from `pending` (skipping `received`); `accept.ts` requires `status='inspected'`. Should Phase 4 enforce `received` (i.e. block dropping the parcel back at the warehouse before inspection) or formalise the skip?

5. **OQ-5 Accountability trigger gaps**:
   - Add a trigger on `stock_returns` (mirroring `update_accountability_on_issue`)?
   - Rewrite `update_accountability_on_issue` to actually update counters?
   - Add a trigger on `stock_consumptions`?
   Or move the rollup logic out of triggers into a materialized view refreshed on demand?

6. **OQ-6 `stock_quants` empty in prod**: was the table ever populated, or has the parallel `stock_levels` / `stock_positions` table replaced it? If quants are the truth, Phase 4 needs a backfill from the 36,264 `stock_serials` + procurement movements. If quants are deprecated, the `process.ts` validation logic (lines 41–60) is checking a perpetually empty table and will always block.

7. **OQ-7 WhatsApp QA ↔ stock_serials reconciliation**: production install data lives in `qa_photo_reviews.ont_serial`, not `stock_serials.installed_at_drop_*`. Should Phase 4 add a reconciler that propagates `qa_photo_reviews` rows back to `stock_serials` (setting `status='installed', installed_at_drop_*`)? Without this, the "issued vs installed" Stage-4 dashboard will mis-report.

8. **OQ-8 Odoo sync revival**: is the Odoo sync (last write 2026-02-19) expected to resume? Phase 4 design must declare whether `field_stock_movements` mirrors to `stock_movements` for Odoo, or whether the Odoo sync is officially shelved.

9. **OQ-9 Asset register vs stock_serials disposition on return**: `accept.ts` updates `stock_serials.status` on disposition. The `assets.status` is not touched. Should `assets` mirror the same transitions (especially for `scrap`/`repair`), and via what mechanism (trigger? service?)?

10. **OQ-10 Restock-vs-write-off PO linkage**: PRD-027 hints at restocked items being re-credited against the original PO line for cost recovery. The current `accept.ts` adds quantity back to `stock_quants` but does not touch `purchase_order_items.quantity_received` (which would understate net received). Should restocks decrement `quantity_received` or be tracked as a separate "credit note received" event?

11. **OQ-11 Duplicate KPI endpoints**: `aggregate-metrics.ts` vs `metrics/aggregate.ts` — Phase 4 should pick one and deprecate the other before adding more dashboards on top.

12. **OQ-12 Phase 3 PR #1678 status**: the referenced spec doc `docs/superpowers/specs/2026-05-20-field-stock-pwa-return-design.md` does not exist on master. If PR #1678 introduced the broken `accept.ts` INSERT, was it ever merged? If yes, when was the schema check missed in review? If no, Phase 4 should land the table-fix first.

---

## Appendix A — File path manifest (sampled key files)

| Purpose | Path |
|---|---|
| GRN confirm — writes to procurement `stock_movements` correctly | `pages/api/procurement/grn-confirm.ts` |
| GRN register assets → `assets` (NOT `stock_serials`) | `pages/api/procurement/grn/[id]/register-assets.ts`, `src/modules/assets/services/assetRegistrationService.ts` |
| Picking process — BROKEN, writes wrong `stock_movements` | `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts:181` |
| Return accept — BROKEN, writes wrong `stock_movements`, no tx | `pages/api/procurement/field-stock/returns/[returnId]/accept.ts:124` |
| Serial register (field-stock) → writes `stock_serials` | `src/modules/procurement/field-stock/services/serialService.ts:170` |
| Consumption service → writes `stock_consumptions` + `field_stock_movements` | `src/modules/procurement/field-stock/services/consumptionService.ts` |
| Serial state machine → writes `field_stock_movements` | `src/services/procurement/serialStateMachine.ts` |
| Odoo stock movement sync → writes procurement `stock_movements` | `src/services/odoo/entities/stockMovementSync.ts:248` |
| Reconciliation service (Stage-4) | `src/modules/field-stock/services/reconciliationService.ts` (Neon shim — tech debt) |
| Migration 027/028/029 (field-stock core) | `scripts/migrations/027_field_stock_core.sql`, `028_field_stock_transactions.sql`, `029_field_stock_returns.sql` |
| Migration 031 (renamed mig-028 `stock_movements` → `field_stock_movements`) | `scripts/migrations/031_field_stock_fixes.sql:44-91` |
| Migration 050/051 (PO + GRN) | `scripts/migrations/050_purchase_orders.sql`, `051_goods_receipt_notes.sql` |
| Migration 116 (Odoo columns on `stock_movements`) | `scripts/migrations/116_odoo_inventory_sync.sql` |
| PRD-027 | `docs/PRDs/PRD-027-field-stock-control.md` |
| PRD-050 | `docs/PRDs/PRD-050-procurement-portal-comprehensive.md` |
| Field-stock module quick reference | `src/modules/field-stock/.claude.md` |
| Procurement module deep reference | `.claude/modules/procurement.md` |

## Appendix B — Live DB row counts (2026-05-21)

```
stock_pickings:                      5 (1 draft, 1 confirmed, 3 cancelled, 0 done)
stock_returns:                       0
stock_consumptions:                  0
stock_quants:                        0
stock_serials:                       36,264 (all loaded via import-serials.ts)
stock_serials WHERE installed_at_drop_id IS NOT NULL:  0
stock_movements:                     341 (last write 2026-02-19; project-based table)
field_stock_movements:               1
goods_receipt_notes:                 325
purchase_orders:                     498
```
