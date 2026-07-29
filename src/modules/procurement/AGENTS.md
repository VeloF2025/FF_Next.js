<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: procurement
<!-- BOQ, RFQ, PO, GRN, stock — full procurement workflow with Odoo sync -->

## Purpose
End-to-end procurement: BOQ import with 4-stage stock matching, RFQ-to-PO workflow, GRN confirmation, inventory tracking, and Odoo stock movement sync.

## Key Files
| File | Purpose |
|------|---------|
| `hooks/useTabPersistence.ts` | Tab state with URL + localStorage sync |
| `services/boq/boqCrud.ts` | BOQ CRUD operations |
| `services/rfq/rfqCrud.ts` | RFQ CRUD operations |
| `../../services/procurement/import/boqImportEnhanced.ts` | BOQ Excel import entry point |
| `../../services/procurement/import/stockMatcher.ts` | 4-stage stock matching pipeline |
| `ProcurementPortalPage.tsx` | Top-level page shell |

## Navigation
| Route | Tabs |
|-------|------|
| `/procurement` | Dashboard (overview) |
| `/procurement/sourcing` | Suppliers, BOQ, RFQ |
| `/procurement/purchasing` | Quotes, Requisitions, PO, GRN |
| `/procurement/inventory` | Stock, Items, Categories, Bundles |
| `/procurement/financial` | Budget, Cost Centers |
| `/procurement/approvals` | Approval workflow |

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/procurement/boq` | List / create BOQs |
| POST | `/api/procurement/boq/import-mapped` | Excel import with column mapping |
| POST | `/api/procurement/boq/rematch-stock` | Re-run stock matching on existing BOQ |
| PUT | `/api/procurement/boq/map-stock-item` | Manual stock item mapping |
| GET/POST | `/api/procurement/rfq` | List / create RFQs |
| POST | `/api/procurement/rfq/{id}/convert-to-po` | Convert RFQ → PO |
| GET/POST | `/api/procurement/stock` | Stock items + movements |
| POST | `/api/procurement/grn-confirm` | Confirm GRN → stock movement |
| GET/POST | `/api/odoo/sync/stock-movements` | Sync Odoo pickings |

## Database Tables
- `boqs` — Bill of Quantities (plural table name)
- `boq_items` — line items with `stock_item_id`, `stock_match_method`, `stock_match_confidence`
- `material_catalog` — 183+ global materials
- `supplier_item_codes` — supplier code → stock item mappings
- `rfq`, `rfq_items` — Request for Quotes
- `purchase_orders` — POs
- `goods_receipt_notes` — GRNs; trigger `tr_grn_stock_update` is DISABLED (API handles updates)
- `goods_receipt_items` — GRN line items
- `stock_items` — inventory (183 items, 7 categories)
- `stock_movements` — unified movements (`source_type`: `odoo` | `fibreflow`)

## Stock Matching Pipeline (4 stages)
1. Supplier code lookup via `supplier_item_codes`
2. Exact/prefix item code match
3. Fiber domain match (category→prefix + parameter scoring)
4. Fuzzy description (keyword overlap + Levenshtein, threshold 0.55)

## Critical Rules
- `boq_items` uses `boq_item_id` not `boq_id`
- GRN confirm trigger is DISABLED — API manages `stock_items.qty_available` directly
- `/api/procurement/rfq` wraps data in `apiResponse.success()` → read as `data?.rfqs`, not `rfqs`
- `/api/procurement/boq` uses `res.json()` directly (no wrapper) — inconsistent, check each endpoint
- Use `COALESCE(s.company_name, s.name)` for supplier names — `company_name` can be NULL
- Pre-load all materials before batch BOQ import — per-row DB queries cause Cloudflare timeout
- Quick Action buttons belong AFTER the header section, never at page bottom
- Park/Resume approval workflow shipped PR #1560; tests still owed

## Common Issues
| Issue | Fix |
|-------|-----|
| Stock showing 0 | Query `stock_items`, not `stock_positions` |
| UUID join error | Cast `project_id::uuid` (TEXT column) |
| Numeric string arithmetic | Wrap with `Number()` before operations |
| RFQ dashboard blank | Use `data?.rfqs` not `rfqs` (apiResponse wrapper) |
| Cloudflare timeout on import | Pre-load materials; use in-memory matching |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
