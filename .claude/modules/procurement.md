# Module: procurement

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | End-to-end procurement workflow - BOQ, RFQ, quotes, PO, suppliers, stock management |
| **Status** | Active |
| **Complexity** | High |
| **Category** | procurement |

## Dependencies

### Internal FF Modules
None

### External Packages
- @tanstack/react-query
- react-hot-toast

## Database

### Tables
- `procurement_projects` - Project-level config
- `boqs` - Bill of Quantities
- `rfqs` - Request for Quotes
- `quotes` - Supplier responses
- `purchase_orders` - Purchase orders (215)
- `goods_receipt_notes` - GRNs (276)
- `goods_receipt_items` - GRN line items
- `stock_items` - Inventory from Odoo (260 items)
- `stock_movements` - Unified movements (source_type: 'odoo'/'fibreflow')
- `stock_movement_items` - Movement line items (604)
- `purchase_requisitions` - Requisition header (requisition_number, project_id, department, requested_by, requested_by_name, status, urgency, estimated_total)
- `purchase_requisition_items` - Requisition line items (item_description, quantity, uom, estimated_unit_price, estimated_total, suggested_supplier_id)
- `approval_workflows` - Workflow definitions per document type
- `approval_levels` - Multi-level approval thresholds (min_amount, max_amount, approver_type, approver_role)
- `approval_requests` - Pending approval instances (document_type, document_id, status, responded_by, response_notes)
- `stock_adjustment_reasons` - 10 predefined adjustment reason codes
- `stock_take_adjustments` - Adjustment records from stock take approval
- `field_stock_movements` - Field stock movement records (movement_type: 'adjustment', 'picking', etc.)
- `stock_quants` - Current stock quantities per (item, location, lot_number)
- `stock_takes` - Stock take header (draft→in_progress→pending_review→approved)
- `stock_take_lines` - Count lines with expected/counted/variance quantities

### Key Queries
- Filter RFQ by projectId, status, supplierId
- Get RFQ responses and compare quotes
- Query supplier performance metrics

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/procurement/*` | Multiple sub-endpoints |
| * | `/api/procurement/projects` | Procurement projects |

## Services

### RFQService
```typescript
getAll(filter)
getById(id)
getResponses(rfqId)
compareResponses(rfqId)
create(data)
update(id, data)
```

### BOQService
Similar CRUD pattern

## Components

### BOQ Components
- BOQDashboard, BOQCreate, BOQEdit, BOQView, BOQList, BOQDetail
- BOQUpload, BOQMappingReview, BOQViewer, BOQHistory

### RFQ Components
- RFQDashboard, RFQCreate, RFQEdit, RFQView, RFQList, RFQDetail
- RFQBuilder, RFQDistribution, RFQTracking, RFQArchive

### Quote Components
- QuoteEvaluationDashboard, QuoteComparison, EvaluationMatrix
- AwardProcess, QuoteHistory

### Supplier Portal Components
- SupplierPortalDashboard, SupplierDashboard, RFQResponse
- DocumentManagement, CommunicationCenter

### Stock Components
- StockManagementDashboard, StockDashboard, GoodsReceipt
- StockMovements, DrumTracking

### PO Components
- PurchaseOrderDashboard, PurchaseOrderCreate, PurchaseOrderEdit
- PurchaseOrderView, PurchaseOrderList, PurchaseOrderDetail

### Reporting Components
- ProcurementReporting, ProcurementKPIDashboard, KPIDashboard
- CostAnalysis, SupplierPerformance, ComplianceReports

## Hooks
```typescript
useRFQ(id)
useRFQs(filter)
useRFQResponses(rfqId)
useCompareRFQResponses(rfqId)
useCreateRFQ()
useUpdateRFQ()
useDeleteRFQ()
useBOQ(id)
useBOQs(filter)
useProcurementPermissions(projectId)
usePickings()        // Pickings CRUD with auto-fetch
useAdjustments()     // Adjustments CRUD with reasons
useStockItems()      // Stock items with search
useLocations()       // Stock locations
```

## Patterns
- React Query for server state (staleTime: 5 minutes)
- Optimistic updates with invalidation
- Toast notifications for user feedback
- Permission-based access control
- Project-scoped workflows (all tied to projectId)

## Gotchas
- **Complex Workflows**: Multi-step workflows with approval limits
- **Separate Portal**: Supplier portal is separate context from internal management
- **Drum Tracking**: Stock tracking includes drum-specific movements
- **Compliance Layer**: Compliance reporting layer required
- **Separate KPI**: KPI dashboard separate from standard reporting
- **Stock Tables**: Use `stock_items` NOT `stock_positions` (positions is empty)
- **Movement Source**: `source_type='odoo'` for synced, `source_type='fibreflow'` for native
- **GRN Trigger Disabled**: `tr_grn_stock_update` disabled - API handles stock updates
- **Odoo Independence**: FibreFlow designed to work without Odoo sync long-term
- **Approval Request ID**: Approve/Reject buttons must use the `approvalRequestId` from the requisition/PO detail, NOT the document ID. The approval endpoints operate on `approval_requests` table.
- **Field Stock Movements Table**: Use `field_stock_movements` (NOT `stock_movements`) for field stock adjustments and pickings
- **Stock Quants**: Use `stock_quants` for current stock quantities, with UPSERT pattern on `(stock_item_id, location_id, lot_number)`
- **Requested By Name**: Requisition creation uses authenticated user name from auth token, not from request body

## Stock Movements Architecture (2026-01-25)
```
Odoo (stock.picking) ──sync──► stock_movements (source_type='odoo')
                                      │
FibreFlow GRN Confirm ─────────► stock_movements (source_type='fibreflow')
                                      │
                                      ▼
                              stock_movement_items
                                      │
                                      ▼
                              stock_items.qty_available
```

## Key APIs
| Endpoint | Purpose |
|----------|---------|
| `POST /api/procurement/grn-confirm` | Confirm GRN, create movement, update stock |
| `GET/POST /api/odoo/sync/stock-movements` | Sync Odoo pickings to FibreFlow |
| `GET /api/procurement/stock` | Stock items + recent movements |
| `GET /api/procurement/aggregate-metrics` | Dashboard metrics + per-project summaries |
| `GET /api/procurement/tab-badges?projectId=` | Real badge counts per tab |
| `GET /api/procurement/quote-evaluations` | RFQ + quote evaluation state |

## Purchase Requisitions (PRD-050)

### Workflow
```
Draft → Submit → Pending Approval → Approved → Convert to PO/RFQ
                                  ↓ (if rejected)
                              Draft (edit & resubmit)
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/procurement/requisitions` | List/Create requisitions |
| GET/PUT/DELETE | `/api/procurement/requisitions/[id]` | Detail/Update/Delete (draft only) |
| POST | `/api/procurement/requisitions/[id]/submit` | Submit draft → pending_approval |
| POST | `/api/procurement/requisitions/[id]/convert-to-po` | Convert approved req to PO |

### Auto-approval
- Requisitions < R10,000 auto-approved (no approval request)
- Requisitions >= R10,000 create `approval_request`, status → `pending_approval`
- Detail API returns `approvalRequestId` for frontend routing

### Pages
| Page | Path |
|------|------|
| Requisition List | `/procurement/requisitions` |
| Requisition Detail | `/procurement/requisitions/[id]` |
| Create Requisition | `/procurement/requisitions/new` |

## Approval Workflow (PRD-050 Phase 2)

Centralized approval system for all procurement document types.

### Tables
- `approval_workflows` - Definitions per document type (7 types)
- `approval_levels` - Multi-level thresholds with approver config
- `approval_requests` - Pending instances linking workflow → document

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/procurement/approvals/pending` | Pending tasks for current user (role-filtered) |
| POST | `/api/procurement/approvals/[id]/approve` | Approve request (notes optional) |
| POST | `/api/procurement/approvals/[id]/reject` | Reject request (reason required) |

### Key Pattern
- Operates on `approval_requests.id`, NOT the document ID
- Both approve/reject update the approval_request AND source document status
- Supported types: `purchase_requisition`, `purchase_order`, `boq`, `rfq`, `goods_receipt`, `supplier_registration`, `payment_request`

### Page
| Page | Path |
|------|------|
| Pending Approvals | `/procurement/approvals` |

## Stock Adjustments (2026-02-20)

### Direct Adjustments
Manual stock quantity adjustments with reason codes.

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/procurement/adjustments` | List adjustments (filters: location_id, reason_code, date range) |
| POST | `/api/procurement/adjustments` | Create adjustment (increase/decrease) |
| GET | `/api/procurement/stock-takes/reasons` | List 10 reason codes |

### Flow
1. Select location + item + direction + quantity + reason
2. Updates `stock_quants` (UPSERT for increase, UPDATE for decrease)
3. Creates `field_stock_movements` record (reference: ADJ-YYYYMM-seq)
4. Virtual ADJUST location (code='ADJUST') as counterparty

### Stock Take Approval → Quant Updates
When stock take approved (`POST /stock-takes/[id]/actions` action='approve'):
- Fetches lines with non-zero variance
- Updates `stock_quants` per variance direction
- Creates `field_stock_movements` + `stock_take_adjustments` records
- Lines marked 'adjusted' (variance) or 'verified' (zero)

## Permissions (RBAC)

Procurement uses real AuthContext RBAC via `useProcurementPermissions(projectId?)` hook.

**Role → Capability Mapping:**
| Role | Approval Limit | Key Capabilities |
|------|---------------|------------------|
| SUPER_ADMIN/ADMIN | R1,000,000 | All permissions |
| PROJECT_MANAGER | R500,000 | Most permissions, approve orders |
| SITE_SUPERVISOR | R100,000 | Stock access, create GRN/requisitions |
| FIELD_TECHNICIAN | R0 | Field stock access only |
| CONTRACTOR | R0 | Field stock access only |

**No projectId selected** → View-only permissions (tabs visible, no create/edit actions).

**Key permission flags:** `canViewBOQ`, `canEditBOQ`, `canViewRFQ`, `canCreateRFQ`, `canViewQuotes`, `canEvaluateQuotes`, `canViewPurchaseOrders`, `canCreatePurchaseOrders`, `canAccessStock`, `canManageStock`, `canAccessFieldStock`, `canManageFieldStock`, `canApproveOrders`, `canAccessReports`, `canViewSuppliers`, `canEditSuppliers`, `canManageSuppliers`, `canViewRequisitions`, `canCreateRequisitions`, `canApproveRequisitions`, `canViewGRN`, `canCreateGRN`.

## Field Stock (Sub-Module)

Fully built infrastructure — DB tables, API endpoints, hooks, UI all wired to real data.

**DB Tables:** `stock_locations`, `stock_items`, `stock_serials`, `stock_pickings`, `stock_picking_items`, `stock_consumptions`, `stock_returns`, `contractor_stock_accountability`

**Migrations:** 027-031 (core tables), 107 (setup views/functions)

**API Endpoints:** `/api/procurement/field-stock/dashboard`, `/locations`, `/serials`, `/consumptions`, `/pickings`, `/returns`, `/accountability`

**Dashboard alerts:** `low_stock` queries `stock_items WHERE quantity <= min_stock_level`

**Additional API Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/procurement/field-stock/items` | Stock items CRUD |
| GET/POST | `/api/procurement/field-stock/pickings` | Pickings list/create |
| GET | `/api/procurement/field-stock/pickings/[pickingId]` | Picking detail |
| POST | `/api/procurement/field-stock/pickings/[pickingId]/process` | Process picking → updates quants |
| GET/POST | `/api/procurement/stock-takes` | Stock takes list/create |
| POST | `/api/procurement/stock-takes/[id]/actions` | State transitions (start/complete/approve/cancel) |
| POST | `/api/procurement/stock-takes/[id]/initialize` | Initialize lines from current quants |
| PUT | `/api/procurement/stock-takes/[id]/lines/[lineId]` | Update counted quantity |
| GET/POST | `/api/procurement/adjustments` | Direct stock adjustments |

**Hooks:** `usePickings`, `useAdjustments`, `useStockItems`, `useLocations`

**Pages:**
| Page | Path | Description |
|------|------|-------------|
| Field Stock | `/procurement/field-stock` | 8 tabs: Dashboard, Locations, Items, Pickings, Returns, Consumptions, Accountability, Adjustments |
| Stock Portal | `/stock/portal` | Mobile-first storeman portal (PWA) |
| Inventory | `/procurement/inventory` | Tabs: Stock, Items, Bundles, Takes, Adjustments, Reports |
