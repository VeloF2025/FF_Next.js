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
- **Approval workflow** with multi-level thresholds
- Version tracking on rejection/resubmit
- Track delivery status

#### PO Approval Workflow (Migration 136)
```
Draft → Submit → Pending Approval → Approved/Rejected
                                  ↓ (if rejected)
                              Draft (v2, v3, etc.)
```

| Level | Threshold | Approver |
|-------|-----------|----------|
| 1 | < R5,000 | Auto-approve |
| 2 | R5,000 - R50,000 | `procurement_manager` role |
| 3 | > R50,000 | `director` role |

- **Escalation:** 48 hours (configurable)
- **Versioning:** Rejected POs increment version and return to draft
- **Quote Comparison:** Approvers see RFQ context and all quotes received

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

## PO Approval Service

Located at `src/services/procurement/approval/poApprovalService.ts`

```typescript
// Submit PO for approval
poApprovalService.submitForApproval(poId, userId, userName)
// Returns: { approvalRequest, autoApproved }

// Approve PO
poApprovalService.approvePO(poId, approverId, approverName, notes?)

// Reject PO (creates new version)
poApprovalService.rejectPO(poId, rejecterId, rejecterName, reason)
// Returns: { newVersion }

// Get approval status
poApprovalService.getApprovalStatus(poId)

// Get quote comparison for approvers
poApprovalService.getQuoteComparisonForApproval(poId)

// Check if user can approve
poApprovalService.canUserApprove(poId, userId)
```

### PO Approval API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/procurement/purchase-orders-approval?poId=xxx` | Get approval status |
| GET | `/api/procurement/purchase-orders-approval?pending=true` | List pending approvals |
| GET | `/api/procurement/purchase-orders-approval?poId=xxx&checkPermission=true` | Check if user can approve |

### PO Approval Components

```
src/modules/procurement/orders/components/
├── PODetailHeader.tsx      # Approve/Reject buttons, version banner
├── PORejectModal.tsx       # Rejection with required reason
└── POQuoteComparison.tsx   # RFQ/quote context for approvers
```

### Database Tables (Migration 136)

| Table | Purpose |
|-------|---------|
| `purchase_order_versions` | Version history with rejection snapshots |
| `purchase_orders.version` | Current version number (default 1) |
| `purchase_orders.current_approval_request_id` | Link to active approval request |

## Gotchas

### Approval Limits
PO approval has value-based thresholds configured in `approval_levels` table (not `procurement_projects`).

### Supplier Portal Separation
Supplier-facing portal is separate context from internal management. Different permissions.

### Drum Tracking
Stock tracking includes drum-specific movements with serial numbers and length tracking.

### Compliance Layer
Compliance reporting required - certain actions need audit trail.

## Troubleshooting

### Pages Return 500 Error (Requisitions, POs, GRN)
**Symptom:** `/procurement/requisitions`, `/procurement/purchase-orders`, or `/procurement/grn` return 500 Internal Server Error.

**Cause:** Stale build on dev/production server.

**Fix:**
```bash
# On Velocity (local) — use dev or production as appropriate
# Dev:
sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull && npm ci && npm run build'
sudo systemctl restart fibreflow-dev.service

# Production:
sudo -u velo bash -c 'cd /home/velo/fibreflow-production && git pull && npm ci && npm run build'
sudo systemctl restart fibreflow-production.service
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

## Purchase Requisitions

### Workflow
```
Draft → Submit → Pending Approval → Approved → Convert to PO/RFQ
                                  ↓ (if rejected)
                              Draft (edit & resubmit)
```

### Requisition API
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/procurement/requisitions` | List/Create requisitions |
| GET/PUT/DELETE | `/api/procurement/requisitions/[id]` | Detail/Update/Delete |
| POST | `/api/procurement/requisitions/[id]/submit` | Submit for approval |
| POST | `/api/procurement/requisitions/[id]/convert-to-po` | Convert to PO |

### Auto-Approval Rules
- Requisitions < R10,000: Auto-approved
- Requisitions >= R10,000: Creates `approval_request`, status → `pending_approval`
- Detail API returns `approvalRequestId` for frontend routing

## Unified Approval Workflow

Centralized approval system for all procurement documents.

### Approval API
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/procurement/approvals/pending` | Pending tasks for current user |
| POST | `/api/procurement/approvals/[id]/approve` | Approve (notes optional) |
| POST | `/api/procurement/approvals/[id]/reject` | Reject (reason required) |

### Supported Document Types
`purchase_requisition`, `purchase_order`, `boq`, `rfq`, `goods_receipt`, `supplier_registration`, `payment_request`

### Critical Pattern
- Approve/Reject uses `approval_request` ID, NOT the document ID
- Both endpoints update the approval_request AND source document status

## Stock Adjustments

### Direct Adjustment API
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/procurement/adjustments` | List adjustments with filters |
| POST | `/api/procurement/adjustments` | Create adjustment (increase/decrease) |
| GET | `/api/procurement/stock-takes/reasons` | List reason codes |

### Adjustment Flow
1. Select item, location, direction, quantity, reason code
2. Updates `stock_quants` (UPSERT for increase, UPDATE for decrease)
3. Creates `field_stock_movements` record (reference: ADJ-YYYYMM-seq)
4. Virtual ADJUST location as counterparty

### Stock Take Approval → Quant Updates
When approved: updates `stock_quants`, creates `field_stock_movements` + `stock_take_adjustments`, marks lines adjusted/verified.

## Field Stock & Inventory

### Key Pages
| Page | Path | Description |
|------|------|-------------|
| Field Stock | `/procurement/field-stock` | 8 tabs: Dashboard, Locations, Items, Pickings, Returns, Consumptions, Accountability, Adjustments |
| Inventory | `/procurement/inventory` | Tabs: Stock, Items, Bundles, Takes, Adjustments, Reports |
| Stock Portal | `/stock/portal` | Mobile-first storeman portal (PWA) |

### Field Stock API
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET/POST | `/api/procurement/field-stock/items` | Stock items |
| GET/POST | `/api/procurement/field-stock/pickings` | Pickings |
| POST | `/api/procurement/field-stock/pickings/[id]/process` | Process picking → updates quants |
| GET/POST | `/api/procurement/stock-takes` | Stock takes |
| POST | `/api/procurement/stock-takes/[id]/actions` | State transitions |

### Hooks
`usePickings`, `useAdjustments`, `useStockItems`, `useLocations`

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
| Requisition Detail | `/procurement/requisitions/[id]` |
| Create Requisition | `/procurement/requisitions/new` |
| Purchase Orders | `/procurement/purchase-orders` |
| PO Detail | `/procurement/purchase-orders/[id]` |
| GRN | `/procurement/grn` |
| Approvals | `/procurement/approvals` |
| Inventory | `/procurement/inventory` |
| Stock | `/procurement/stock` |
| Field Stock | `/procurement/field-stock` |
| Stock Portal | `/stock/portal` |
| Suppliers | `/suppliers` |
