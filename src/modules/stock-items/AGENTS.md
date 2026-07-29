<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: stock-items
<!-- Stock catalog with tool checkout/check-in tracking and Odoo sync -->

## Purpose
Manages the stock item catalog with quantity tracking, category filtering, tool checkout/check-in workflow, and CSV export.

## Key Files
| File | Purpose |
|------|---------|
| `StockItemsPage.tsx` | Main page: list, filter, create, checkout/check-in |
| `components/StockItemRow.tsx` | Table row with inline checkout status |
| `components/StockItemModal.tsx` | Create / edit stock item form |
| `components/ToolCheckoutModals.tsx` | CheckOutModal + CheckInModal |
| `components/SerialsPanel.tsx` | Serial number tracking per item |
| `hooks/useStockItems.ts` | SWR fetch with pagination + category filter |
| `hooks/useToolCheckouts.ts` | Active + overdue checkout lists |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/stock-items` | List (paginated) / create stock item |
| GET/PUT/DELETE | `/api/stock-items/[itemId]` | Item detail ops |
| POST | `/api/stock-items/checkout` | Check out tool to staff member |
| POST | `/api/stock-items/checkin` | Return checked-out tool |
| GET | `/api/stock-items/checkouts` | List active checkouts |
| GET | `/api/stock-items/stock-items-export` | CSV export |
| GET/POST | `/api/stock/serials` | Serial number records |
| GET | `/api/stock/serial-history` | Serial movement history |
| GET | `/api/procurement/stock-items-search` | Search for procurement BOQ matching |

## Database Tables
- `stock_items` — catalog: item_code, name, category, quantity, odoo_product_id
- `tool_checkouts` — active/historical checkouts: stock_item_id, checked_out_by, due_date

## Critical Rules
- `canManageCheckouts` requires `PROJECT_MANAGER`, `ADMIN`, or `SUPER_ADMIN` role
- Category filter syncs with URL query param (`?category=...`) for deep-linking from category views
- `odoo_product_id` links to Odoo for procurement reconciliation — do not null it out
- Sort defaults: `item_code ASC`, page size 25

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
