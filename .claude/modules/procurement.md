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
