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
- `purchase_orders` - Purchase orders
- `stock_positions` - Stock tracking

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
