# Procurement Module Skill

End-to-end procurement workflow - BOQ, RFQ, quotes, PO, suppliers, and stock management.

## Overview
Complete procurement lifecycle management from Bill of Quantities through Purchase Orders to Stock tracking.

## Quick Reference

| Setting | Value |
|---------|-------|
| **Dashboard URL** | `/procurement` |
| **API Prefix** | `/api/procurement/*` |
| **Suppliers Page** | `/suppliers` |
| **Stock Page** | `/procurement/stock` |
| **Status** | Active (High Complexity) |

## Database Tables

| Table | Purpose |
|-------|---------|
| `procurement_projects` | Project-level procurement config |
| `boqs` | Bill of Quantities items |
| `rfqs` | Request for Quotes |
| `quotes` | Supplier quote responses |
| `purchase_orders` | Purchase orders |
| `stock_positions` | Stock tracking |
| `suppliers` | Supplier master data |

## Workflow Overview

```
BOQ → RFQ → Quotes → Evaluation → PO → GRN → Stock
```

### 1. BOQ (Bill of Quantities)
- Define materials needed for project
- Upload BOQ from Excel
- Map items to catalog

### 2. RFQ (Request for Quote)
- Create RFQ from BOQ items
- Distribute to multiple suppliers
- Track response status

### 3. Quote Evaluation
- Compare supplier responses
- Evaluation matrix scoring
- Award recommendation

### 4. Purchase Order
- Generate PO from awarded quote
- Approval workflow based on limits
- Track delivery status

### 5. GRN (Goods Receipt Note)
- Receive goods against PO
- Quality inspection
- Update stock positions

### 6. Stock Management
- Track stock levels per project
- Drum tracking for cable
- Movement history

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/procurement/projects` | Procurement projects |
| GET/POST | `/api/procurement/boq` | BOQ management |
| GET/POST | `/api/procurement/rfq` | RFQ operations |
| GET/POST | `/api/procurement/quotes` | Quote responses |
| GET/POST | `/api/procurement/purchase-orders` | PO management |
| GET/POST | `/api/procurement/stock` | Stock positions |
| GET | `/api/procurement/suppliers/performance` | Supplier metrics |

## Services

### RFQService
```typescript
getAll(filter)       // Filter by projectId, status, supplierId
getById(id)          // Single RFQ details
getResponses(rfqId)  // All responses to RFQ
compareResponses(rfqId) // Quote comparison data
create(data)         // Create new RFQ
update(id, data)     // Update RFQ
```

### BOQService
```typescript
getAll(filter)       // Filter by projectId
getById(id)          // Single BOQ
import(file)         // Import from Excel
mapItems(boqId, mapping) // Map to catalog
```

### StockService
```typescript
getPositions(projectId) // Current stock levels
recordReceipt(data)     // GRN processing
recordMovement(data)    // Transfer/issue
getDrumHistory(drumId)  // Drum tracking
```

## Hooks

```typescript
// RFQ Hooks
useRFQ(id)                    // Single RFQ
useRFQs(filter)               // RFQ list with filters
useRFQResponses(rfqId)        // Responses for RFQ
useCompareRFQResponses(rfqId) // Comparison data
useCreateRFQ()                // Mutation
useUpdateRFQ()                // Mutation
useDeleteRFQ()                // Mutation

// BOQ Hooks
useBOQ(id)                    // Single BOQ
useBOQs(filter)               // BOQ list

// Permissions
useProcurementPermissions(projectId)
```

## Key Components

### BOQ Components
```
src/components/procurement/boq/
├── BOQDashboard.tsx      # Main BOQ view
├── BOQCreate.tsx         # Create new BOQ
├── BOQUpload.tsx         # Excel upload
├── BOQMappingReview.tsx  # Item mapping UI
├── BOQList.tsx           # List view
└── BOQViewer.tsx         # Read-only view
```

### RFQ Components
```
src/components/procurement/rfq/
├── RFQDashboard.tsx      # Main RFQ view
├── RFQCreate.tsx         # Create from BOQ
├── RFQBuilder.tsx        # Build RFQ items
├── RFQDistribution.tsx   # Send to suppliers
├── RFQTracking.tsx       # Response tracking
└── RFQList.tsx           # List view
```

### Quote Evaluation
```
src/components/procurement/quotes/
├── QuoteEvaluationDashboard.tsx
├── QuoteComparison.tsx   # Side-by-side
├── EvaluationMatrix.tsx  # Scoring
└── AwardProcess.tsx      # Award workflow
```

### Supplier Portal
```
src/components/procurement/supplier-portal/
├── SupplierDashboard.tsx    # Supplier view
├── RFQResponse.tsx          # Submit quote
└── DocumentManagement.tsx   # Upload docs
```

### Stock Management
```
src/components/procurement/stock/
├── StockDashboard.tsx    # Overview
├── GoodsReceipt.tsx      # GRN processing
├── StockMovements.tsx    # Movement log
└── DrumTracking.tsx      # Cable drums
```

## Common Patterns

1. **React Query** - Server state with 5-minute staleTime
2. **Optimistic Updates** - UI updates before server confirms
3. **Toast Notifications** - User feedback via react-hot-toast
4. **Permission-Based** - Access control per project
5. **Project-Scoped** - All data tied to projectId

## Gotchas

### Approval Limits
PO approval has value-based thresholds. Check `procurement_projects` config for limits.

### Supplier Portal Separation
Supplier-facing portal is separate context from internal management. Different permissions.

### Drum Tracking
Stock tracking includes drum-specific movements with serial numbers and length tracking.

### Compliance Layer
Compliance reporting required - certain actions need audit trail.

## Troubleshooting

### Pages Return 500 Error (Requisitions, POs, GRN)
**Symptom:** `/procurement/requisitions`, `/procurement/purchase-orders`, or `/procurement/grn` return 500 Internal Server Error.

**Cause:** Stale build on staging/production server.

**Fix:**
```bash
# On staging server
ssh velo@100.96.203.105
cd /home/velo/fibreflow
git pull && npm ci && npm run build
echo 'velo2026' | sudo -S systemctl restart fibreflow.service
```

**Verified Jan 2026:** All three pages work after rebuild. The APIs (`/api/procurement/requisitions`, etc.) work fine - only the page SSR was affected.

### BOQ Import Fails
```sql
-- Check recent imports
SELECT * FROM boqs
WHERE project_id = 'xxx'
ORDER BY created_at DESC;
```

### RFQ Not Showing for Supplier
- Check supplier is assigned to RFQ
- Verify supplier portal permissions
- Check RFQ status is 'published'

### Stock Discrepancy
```sql
-- Compare receipts vs movements
SELECT
  sum(case when type = 'receipt' then quantity else 0 end) as received,
  sum(case when type = 'issue' then quantity else 0 end) as issued
FROM stock_movements
WHERE project_id = 'xxx';
```

## Related Skills

- `/oes-import` - OES data imports
- `/activate` - Activation tracking
- `/suppliers` - Supplier management

## Pages

| Page | Path |
|------|------|
| Procurement Dashboard | `/procurement` |
| BOQ List | `/procurement/boq` |
| New BOQ | `/procurement/boq/new` |
| RFQ List | `/procurement/rfq` |
| New RFQ | `/procurement/rfq/new` |
| Requisitions | `/procurement/requisitions` |
| Purchase Orders | `/procurement/purchase-orders` |
| GRN | `/procurement/grn` |
| Approvals | `/procurement/approvals` |
| Stock | `/procurement/stock` |
| Field Stock | `/procurement/field-stock` |
| Suppliers | `/suppliers` |
