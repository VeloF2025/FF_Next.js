# Procurement & Budget Module Integration

> **Document Version:** 1.0
> **Created:** 2026-01-16
> **Status:** Baseline Documentation (Pre-Enhancement)
> **Author:** AI Assistant

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture](#current-architecture)
3. [Database Schema](#database-schema)
4. [Module Structure](#module-structure)
5. [Integration Points](#integration-points)
6. [Workflow Documentation](#workflow-documentation)
7. [Identified Gaps](#identified-gaps)
8. [Enhancement Roadmap](#enhancement-roadmap)

---

## Executive Summary

FibreFlow's Procurement and Budget modules are designed to work together to provide comprehensive financial control over project spending. The system uses database triggers to automatically track budget commitments (from Purchase Orders) and actual spending (from Goods Receipt Notes).

### Current State Summary

| Aspect | Status | Notes |
|--------|--------|-------|
| Budget Creation | ✅ Complete | Manual or BOQ-synced |
| Category Tracking | ✅ Complete | 7 default + custom categories |
| PO → Budget Commitment | ✅ Complete | Automatic via trigger |
| GRN → Actual Spending | ✅ Complete | Automatic via trigger |
| Budget Alerts | ✅ Complete | Warning/Critical thresholds |
| BOQ → Budget Sync | ⚠️ Partial | Category mapping only, no item-level |
| PR → Budget Check | ❌ Missing | No budget validation on requisitions |
| RFQ → Budget Pipeline | ❌ Missing | Quote amounts not tracked |
| Item-Level Budget Tracking | ❌ Missing | Categories only, not BOQ items |

---

## Current Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PROJECT LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐          │
│  │  CREATE  │────▶│   BOQ    │────▶│  BUDGET  │────▶│ PROCURE  │          │
│  │ PROJECT  │     │  IMPORT  │     │   SYNC   │     │  CYCLE   │          │
│  └──────────┘     └──────────┘     └──────────┘     └──────────┘          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        BUDGET TRACKING FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Total Budget                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │ $100,000                                                             │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   Committed (from approved POs)                                            │
│   ┌───────────────────────────────────────┐                                │
│   │ $45,000 (45%)                         │                                │
│   └───────────────────────────────────────┘                                │
│                                                                             │
│   Actual Spent (from completed GRNs)                                       │
│   ┌────────────────────────────┐                                           │
│   │ $30,000 (30%)              │                                           │
│   └────────────────────────────┘                                           │
│                                                                             │
│   Available = Total - Committed = $55,000                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Location |
|-------|------------|----------|
| Database | Neon PostgreSQL | Cloud (Azure) |
| API | Next.js API Routes | `pages/api/` |
| Types | TypeScript | `src/types/` |
| Components | React/Tailwind | `src/components/` |
| Triggers | PostgreSQL Functions | `scripts/migrations/` |

---

## Database Schema

### Budget Tables (Migration 056)

#### `project_budgets` - Master Budget Record

```sql
CREATE TABLE project_budgets (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id),

    -- Source
    source_type VARCHAR(30) DEFAULT 'manual',  -- 'manual' | 'boq' | 'hybrid'
    boq_id UUID REFERENCES boqs(id),

    -- Amounts
    total_budget DECIMAL(15,2) DEFAULT 0,
    committed_amount DECIMAL(15,2) DEFAULT 0,      -- Updated by PO trigger
    actual_amount DECIMAL(15,2) DEFAULT 0,         -- Updated by GRN trigger
    available_budget DECIMAL(15,2) GENERATED,      -- total - committed

    -- Settings
    status VARCHAR(30) DEFAULT 'draft',            -- draft|approved|locked|closed
    enforce_budget BOOLEAN DEFAULT true,
    allow_override BOOLEAN DEFAULT true,
    alert_threshold_warning DECIMAL DEFAULT 80,    -- Percentage
    alert_threshold_critical DECIMAL DEFAULT 100,  -- Percentage

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### `budget_categories` - Category Breakdown

```sql
CREATE TABLE budget_categories (
    id UUID PRIMARY KEY,
    project_budget_id UUID REFERENCES project_budgets(id),

    category_code VARCHAR(50),      -- 'MATERIALS', 'LABOR', etc.
    category_name VARCHAR(255),

    allocated_amount DECIMAL(15,2) DEFAULT 0,
    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,
    available_amount DECIMAL(15,2) GENERATED,  -- allocated - committed

    is_custom BOOLEAN DEFAULT false,
    sort_order INTEGER DEFAULT 0
);
```

**Default Categories:**

| Code | Name | Sort Order |
|------|------|------------|
| MATERIALS | Materials & Consumables | 1 |
| EQUIPMENT | Equipment & Tools | 2 |
| LABOR | Labor Costs | 3 |
| SUBCONTRACT | Subcontractor Work | 4 |
| TRANSPORT | Transport & Logistics | 5 |
| OVERHEAD | Overhead & Admin | 6 |
| CONTINGENCY | Contingency Reserve | 7 |

#### `budget_transactions` - Audit Ledger

```sql
CREATE TABLE budget_transactions (
    id UUID PRIMARY KEY,
    project_budget_id UUID REFERENCES project_budgets(id),
    category_id UUID REFERENCES budget_categories(id),

    transaction_type VARCHAR(30),  -- See types below
    source_type VARCHAR(50),       -- 'purchase_order', 'goods_receipt_note', 'boq'
    source_id UUID,
    source_number VARCHAR(100),

    amount DECIMAL(15,2),
    tax_amount DECIMAL(15,2) DEFAULT 0,

    running_committed DECIMAL(15,2),
    running_actual DECIMAL(15,2),

    description TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP
);
```

**Transaction Types:**

| Type | Trigger | Effect |
|------|---------|--------|
| `allocation` | BOQ sync / Manual | Sets category allocation |
| `adjustment` | Manual adjustment | Increases/decreases budget |
| `commitment` | PO approved | Increases committed_amount |
| `commitment_reversal` | PO cancelled | Decreases committed_amount |
| `receipt` | GRN completed | Increases actual_amount |
| `invoice` | Invoice received | Records invoice (future) |
| `payment` | Payment made | Records payment (future) |

#### `budget_alerts` - Threshold Notifications

```sql
CREATE TABLE budget_alerts (
    id UUID PRIMARY KEY,
    project_budget_id UUID REFERENCES project_budgets(id),

    alert_type VARCHAR(30),     -- threshold_warning|critical|over_budget|po_blocked
    severity VARCHAR(20),       -- info|warning|critical

    threshold_percent DECIMAL(5,2),
    current_percent DECIMAL(5,2),

    title VARCHAR(255),
    message TEXT,

    status VARCHAR(20) DEFAULT 'active',  -- active|acknowledged|resolved
    acknowledged_by VARCHAR(255),
    acknowledged_at TIMESTAMP
);
```

### Procurement Tables

#### `boqs` / `boq` - Bill of Quantities

```sql
CREATE TABLE boqs (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    boq_number VARCHAR(100) UNIQUE,

    title VARCHAR(255),
    description TEXT,
    version INTEGER DEFAULT 1,
    status VARCHAR(50) DEFAULT 'draft',  -- draft|pending|approved|final

    total_amount DECIMAL(15,2),
    currency VARCHAR(3) DEFAULT 'ZAR',

    prepared_by UUID,
    approved_by UUID,
    approved_at TIMESTAMP,

    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

#### `boq_items` - BOQ Line Items

```sql
CREATE TABLE boq_items (
    id UUID PRIMARY KEY,
    boq_id UUID REFERENCES boqs(id),
    product_id UUID REFERENCES products(id),

    item_code VARCHAR(100),
    description TEXT NOT NULL,
    category VARCHAR(100),        -- ⚠️ No FK to budget_categories

    quantity DECIMAL(12,3),
    unit VARCHAR(50),
    unit_price DECIMAL(12,2),
    total_price DECIMAL(15,2),

    specifications JSONB,
    notes TEXT,
    sort_order INTEGER
);
```

#### `purchase_orders` - Purchase Orders

```sql
CREATE TABLE purchase_orders (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    supplier_id UUID REFERENCES suppliers(id),

    po_number VARCHAR(100) UNIQUE,
    status VARCHAR(50),  -- draft|pending_approval|approved|sent|acknowledged|
                         -- partially_received|received|completed|cancelled

    total_amount DECIMAL(15,2),
    tax_amount DECIMAL(15,2),

    -- Budget integration (added by migration 056)
    budget_category_id UUID REFERENCES budget_categories(id),
    budget_override_approved BOOLEAN DEFAULT false,
    budget_override_by VARCHAR(255),
    budget_override_reason TEXT,

    created_at TIMESTAMP,
    updated_at TIMESTAMP,
    updated_by VARCHAR(255)
);
```

#### `goods_receipt_notes` - GRN

```sql
CREATE TABLE goods_receipt_notes (
    id UUID PRIMARY KEY,
    purchase_order_id UUID REFERENCES purchase_orders(id),

    grn_number VARCHAR(100) UNIQUE,
    status VARCHAR(50),  -- draft|pending_inspection|inspected|completed|rejected

    total_amount DECIMAL(15,2),

    received_by VARCHAR(255),
    received_at TIMESTAMP
);
```

---

## Module Structure

### Budget Module Files

```
src/
├── types/
│   └── budget.ts                              # TypeScript interfaces
│
├── components/
│   └── budget/
│       ├── BudgetOverviewCard.tsx            # Summary card component
│       ├── CategoryBreakdownTable.tsx        # Category allocation table
│       ├── BudgetAlertsPanel.tsx             # Alert notifications
│       ├── BudgetAdjustmentModal.tsx         # Manual adjustment dialog
│       ├── BudgetDashboardWidget.tsx         # Dashboard widget
│       └── index.ts                          # Barrel exports
│
├── modules/
│   └── projects/
│       └── types/
│           └── budget.types.ts               # Re-exports from src/types

pages/
├── projects/
│   └── [id]/
│       └── budget.tsx                        # Budget management page
│
└── api/
    ├── projects/
    │   └── [projectId]/
    │       └── budget/
    │           ├── index.ts                  # GET/POST/PUT budget CRUD
    │           ├── categories.ts             # Category management
    │           ├── transactions.ts           # Transaction history
    │           ├── alerts.ts                 # Alert list
    │           ├── alerts/[alertId].ts       # Alert acknowledgment
    │           ├── adjust.ts                 # Budget adjustment
    │           └── sync-boq.ts               # BOQ synchronization
    │
    └── budget/
        └── check.ts                          # Budget availability check
```

### Procurement Module Files

```
src/modules/procurement/
├── index.ts                                   # Module exports
├── ProcurementPage.tsx                        # Main portal page
│
├── types/
│   ├── procurement.types.ts                   # Core types
│   ├── base.types.ts                          # Base entity types
│   └── index.ts                               # Type exports
│
├── boq/
│   ├── BOQListPage.tsx                        # BOQ list view
│   └── components/                            # BOQ components
│
├── rfq/
│   ├── RFQListPage.tsx                        # RFQ list view
│   └── components/                            # RFQ components
│
├── orders/
│   ├── PurchaseOrdersPage.tsx                 # PO list view
│   ├── components/
│   │   ├── PODetailModal.tsx
│   │   ├── POCreateModal.tsx
│   │   └── po-create-modal/
│   │       ├── BasicInfoStep.tsx
│   │       ├── LineItemsStep.tsx
│   │       ├── ReviewStep.tsx
│   │       └── usePOForm.ts
│   └── hooks/
│       ├── usePOData.ts
│       └── usePOActions.ts
│
├── field-stock/                               # Field stock management
│   ├── components/
│   ├── hooks/
│   └── services/
│
├── suppliers/                                 # Supplier portal
│   ├── SupplierPortal.tsx
│   └── components/
│
└── components/
    ├── ProcurementDashboard.tsx
    ├── ProcurementPortalRouter.tsx
    └── tabs/
        ├── DashboardTab.tsx
        ├── BOQTab.tsx
        ├── RFQTab.tsx
        ├── QuoteEvaluationTab.tsx
        ├── PurchaseOrdersTab.tsx
        └── StockMovementTab.tsx

pages/api/procurement/
├── boq/index.ts                               # BOQ CRUD
├── rfq/index.ts                               # RFQ CRUD
├── purchase-orders/
│   ├── index.ts                               # List/Create PO
│   └── [id].ts                                # PO detail/update
├── grn/
│   ├── index.ts                               # List/Create GRN
│   └── [id].ts                                # GRN detail
├── requisitions/                              # Purchase requisitions
├── approvals/                                 # Approval workflow
├── field-stock/                               # Field stock APIs
└── metrics/aggregate.ts                       # Analytics
```

---

## Integration Points

### 1. BOQ → Budget Synchronization

**Endpoint:** `POST /api/projects/[projectId]/budget/sync-boq`

**Flow:**
```
BOQ (status='approved')
    │
    ▼
Sync Endpoint Called
    │
    ├─▶ Validate BOQ is approved
    │
    ├─▶ Create/Update project_budget
    │   └─ source_type = 'boq'
    │   └─ boq_id = <boq_id>
    │   └─ total_budget = BOQ.total_amount
    │
    ├─▶ Map BOQ categories to budget categories
    │   └─ materials → MATERIALS
    │   └─ labor/labour → LABOR
    │   └─ equipment → EQUIPMENT
    │   └─ subcontractor → SUBCONTRACT
    │   └─ transport → TRANSPORT
    │   └─ overhead → OVERHEAD
    │   └─ contingency → CONTINGENCY
    │
    ├─▶ Update category allocations
    │
    └─▶ Create 'allocation' transaction record
```

**Category Mapping Table:**

| BOQ Category (lowercase) | Budget Category Code |
|--------------------------|---------------------|
| materials, material, consumables | MATERIALS |
| equipment, tools, plant | EQUIPMENT |
| labor, labour, workforce | LABOR |
| subcontractor, subcontract, sub-contractor | SUBCONTRACT |
| transport, logistics, delivery | TRANSPORT |
| overhead, admin, management | OVERHEAD |
| contingency, reserve, provisional | CONTINGENCY |

### 2. PO Approval → Budget Commitment

**Trigger:** `trg_budget_po_approval` on `purchase_orders`

**Flow:**
```
PO status changes to 'approved'
    │
    ▼
Trigger Function: update_budget_on_po_approval()
    │
    ├─▶ Get project_budget for PO.project_id
    │
    ├─▶ UPDATE project_budgets
    │   SET committed_amount += PO.total_amount
    │
    ├─▶ IF PO.budget_category_id IS NOT NULL:
    │   UPDATE budget_categories
    │   SET committed_amount += PO.total_amount
    │
    ├─▶ INSERT budget_transactions (type='commitment')
    │
    └─▶ CALL check_budget_thresholds()
        └─ May create budget_alerts if threshold exceeded
```

### 3. PO Cancellation → Commitment Reversal

**Trigger:** Same as above

**Flow:**
```
PO status changes to 'cancelled' (from 'approved')
    │
    ▼
Trigger Function
    │
    ├─▶ UPDATE project_budgets
    │   SET committed_amount -= PO.total_amount
    │
    ├─▶ UPDATE budget_categories (if category set)
    │   SET committed_amount -= PO.total_amount
    │
    └─▶ INSERT budget_transactions (type='commitment_reversal')
```

### 4. GRN Completion → Actual Spending

**Trigger:** `trg_budget_grn_completion` on `goods_receipt_notes`

**Flow:**
```
GRN status changes to 'completed'
    │
    ▼
Trigger Function: update_budget_on_grn_completion()
    │
    ├─▶ Get PO from GRN.purchase_order_id
    │
    ├─▶ Get project_budget from PO.project_id
    │
    ├─▶ UPDATE project_budgets
    │   SET actual_amount += GRN.total_amount
    │
    ├─▶ IF PO.budget_category_id IS NOT NULL:
    │   UPDATE budget_categories
    │   SET actual_amount += GRN.total_amount
    │
    └─▶ INSERT budget_transactions (type='receipt')
```

### 5. Budget Availability Check

**Endpoint:** `POST /api/budget/check`

**Request:**
```json
{
  "projectId": "uuid",
  "amount": 5000.00,
  "categoryId": "uuid (optional)"
}
```

**Response:**
```json
{
  "allowed": true,
  "reason": "ok",
  "available": 55000.00,
  "requested": 5000.00,
  "allowOverride": true,
  "utilizationBefore": 45.00,
  "utilizationAfter": 50.00,
  "warning": false
}
```

**Reason Codes:**

| Code | Meaning |
|------|---------|
| `ok` | Within budget, proceed |
| `over_budget` | Exceeds project budget |
| `category_over_budget` | Exceeds category allocation |
| `no_budget` | No budget configured for project |

---

## Workflow Documentation

### Complete Procurement Workflow

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE PROCUREMENT WORKFLOW                        │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  PHASE 1: PROJECT SETUP                                                    │
│  ────────────────────────                                                  │
│  1. Create Project                                                         │
│  2. Create/Import BOQ                                                      │
│  3. Review and Approve BOQ                                                 │
│  4. Sync BOQ → Budget (creates budget with category allocations)           │
│  5. Review and Approve Budget                                              │
│                                                                            │
│  PHASE 2: REQUISITION & SOURCING                                           │
│  ─────────────────────────────────                                         │
│  6. Create Purchase Requisition (PR)                                       │
│     ⚠️ GAP: No budget check at this stage                                  │
│  7. Submit PR for Approval                                                 │
│  8. Approve PR                                                             │
│  9. Convert PR to RFQ (optional - for quotes)                              │
│  10. Send RFQ to Suppliers                                                 │
│  11. Receive Supplier Quotes                                               │
│      ⚠️ GAP: Quote amounts not tracked as "pipeline"                       │
│  12. Evaluate Quotes                                                       │
│  13. Select Winning Quote                                                  │
│                                                                            │
│  PHASE 3: PURCHASE ORDER                                                   │
│  ───────────────────────                                                   │
│  14. Create PO from PR/RFQ/Quote                                           │
│      ✅ Budget check via POST /api/budget/check                            │
│  15. Assign Budget Category to PO                                          │
│  16. If over budget:                                                       │
│      - Block PO creation (if enforce_budget=true)                          │
│      - OR Request override (if allow_override=true)                        │
│  17. Submit PO for Approval                                                │
│  18. Approve PO                                                            │
│      ✅ TRIGGER: committed_amount updated automatically                    │
│      ✅ Alert created if threshold exceeded                                │
│  19. Send PO to Supplier                                                   │
│                                                                            │
│  PHASE 4: RECEIPT & PAYMENT                                                │
│  ──────────────────────────                                                │
│  20. Receive Goods (create GRN)                                            │
│  21. Inspect Goods                                                         │
│  22. Complete GRN                                                          │
│      ✅ TRIGGER: actual_amount updated automatically                       │
│  23. Receive Invoice                                                       │
│  24. Process Payment                                                       │
│      ⚠️ GAP: Invoice/Payment not tracked in budget                        │
│                                                                            │
│  PHASE 5: MONITORING                                                       │
│  ────────────────────                                                      │
│  25. Budget Dashboard shows real-time status                               │
│  26. Alerts auto-generated at 80%/100% thresholds                          │
│  27. Transaction history provides audit trail                              │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Identified Gaps

### GAP-001: No BOQ Item to Budget Category Link

**Current State:**
- `boq_items.category` is a VARCHAR field
- During sync, category names are matched to budget codes via string matching
- No foreign key relationship exists

**Impact:**
- Cannot track budget at BOQ item level
- Category mapping is fragile (depends on naming conventions)
- Cannot allocate budget to specific line items

**Recommendation:**
Add `budget_category_id` FK to `boq_items` table for explicit mapping.

---

### GAP-002: No Budget Items Table

**Current State:**
- Budget tracks at category level only (MATERIALS, LABOR, etc.)
- Cannot break down by individual BOQ items

**Impact:**
- Limited granularity for budget tracking
- Cannot see which specific items are consuming budget
- No visibility into item-level variances

**Recommendation:**
Create `budget_items` table linked to both `budget_categories` and `boq_items`.

---

### GAP-003: No PR → Budget Validation

**Current State:**
- Purchase Requisitions can be created without budget check
- Budget validation only happens at PO creation

**Impact:**
- Requisitions may be approved that exceed budget
- Late discovery of budget issues delays procurement
- Poor planning visibility

**Recommendation:**
Add budget check on PR submission using existing `check_budget_availability()` function.

---

### GAP-004: No RFQ Pipeline Tracking

**Current State:**
- RFQ responses (quotes) are received but not tracked against budget
- Only approved POs affect committed amount

**Impact:**
- No visibility into potential commitments from active RFQs
- Budget planning doesn't account for pending quotes
- Surprise over-commitment when multiple POs approved

**Recommendation:**
Add "pipeline" or "tentative" commitment tracking for RFQ totals.

---

### GAP-005: No Budget Override Audit Table

**Current State:**
- Override fields exist on `purchase_orders` table
- No historical record of override decisions

**Impact:**
- Cannot audit who approved over-budget purchases and why
- No trend analysis on override frequency
- Compliance gaps

**Recommendation:**
Create `budget_overrides` audit table with approval chain.

---

### GAP-006: Invoice/Payment Not Budget Tracked

**Current State:**
- GRN completion updates actual_amount
- Invoice and payment processing not tracked

**Impact:**
- Cannot reconcile budget vs. invoiced vs. paid amounts
- Three-way matching not supported in budget system
- Cash flow visibility missing

**Recommendation:**
Add invoice and payment transaction types with separate tracking columns.

---

### GAP-007: No Portfolio Budget View

**Current State:**
- Budget is strictly per-project
- No aggregation across projects

**Impact:**
- Cannot see company-wide budget utilization
- No portfolio-level financial planning
- Limited executive visibility

**Recommendation:**
Add portfolio budget aggregation queries and dashboard.

---

### GAP-008: Category Mapping is String-Based

**Current State:**
- BOQ categories are matched to budget categories via lowercase string matching
- Unrecognized categories default to MATERIALS

**Impact:**
- Data quality issues from inconsistent naming
- Items misclassified
- No validation at data entry

**Recommendation:**
Enforce category selection from predefined list, or create mapping table.

---

## Enhancement Roadmap

### Phase 1: BOQ-Budget Item Integration (Immediate)

**Goal:** Enable item-level budget tracking

**Tasks:**
1. Create `budget_items` table linking BOQ items to budget categories
2. Add `budget_category_id` FK to `boq_items` table
3. Update BOQ import to assign categories during import
4. Update sync-boq endpoint to create budget_items
5. Add item-level views to budget dashboard

**Schema Addition:**
```sql
CREATE TABLE budget_items (
    id UUID PRIMARY KEY,
    project_budget_id UUID REFERENCES project_budgets(id),
    budget_category_id UUID REFERENCES budget_categories(id),
    boq_item_id UUID REFERENCES boq_items(id),

    description TEXT,
    quantity DECIMAL(12,3),
    unit VARCHAR(50),
    unit_price DECIMAL(12,2),
    total_amount DECIMAL(15,2),

    committed_amount DECIMAL(15,2) DEFAULT 0,
    actual_amount DECIMAL(15,2) DEFAULT 0,

    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

---

### Phase 2: PR Budget Validation (Short-term)

**Goal:** Catch budget issues early in requisition process

**Tasks:**
1. Add budget check to PR submission API
2. Show budget status on PR form
3. Block/warn on over-budget PRs
4. Add PR amount to "pending" budget view

---

### Phase 3: RFQ Pipeline Tracking (Short-term)

**Goal:** Show potential commitments from active quotes

**Tasks:**
1. Add "pipeline_amount" column to project_budgets
2. Update pipeline when RFQ responses received
3. Clear pipeline when RFQ closed or PO created
4. Show pipeline in budget dashboard

---

### Phase 4: Budget Override Audit (Medium-term)

**Goal:** Full audit trail for over-budget approvals

**Tasks:**
1. Create `budget_overrides` table
2. Add approval workflow for overrides
3. Require reason and approver for all overrides
4. Add override report for compliance

---

### Phase 5: Invoice/Payment Tracking (Medium-term)

**Goal:** Complete financial lifecycle tracking

**Tasks:**
1. Add `invoiced_amount` and `paid_amount` to project_budgets
2. Create invoice processing APIs
3. Link payments to invoices
4. Add three-way match validation

---

### Phase 6: Portfolio View (Long-term)

**Goal:** Cross-project budget visibility

**Tasks:**
1. Create portfolio budget aggregation queries
2. Add portfolio dashboard page
3. Implement budget allocation across projects
4. Add portfolio-level alerts

---

## API Reference

### Budget Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects/{id}/budget` | Get project budget |
| POST | `/api/projects/{id}/budget` | Create project budget |
| PUT | `/api/projects/{id}/budget` | Update budget settings |
| GET | `/api/projects/{id}/budget/categories` | List categories |
| POST | `/api/projects/{id}/budget/categories` | Add custom category |
| PUT | `/api/projects/{id}/budget/categories/{catId}` | Update allocation |
| GET | `/api/projects/{id}/budget/transactions` | Get audit trail |
| GET | `/api/projects/{id}/budget/alerts` | List alerts |
| PATCH | `/api/projects/{id}/budget/alerts/{alertId}` | Acknowledge alert |
| POST | `/api/projects/{id}/budget/adjust` | Manual adjustment |
| POST | `/api/projects/{id}/budget/sync-boq` | Sync from BOQ |
| POST | `/api/budget/check` | Check availability |

### Procurement Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/procurement/boq` | BOQ CRUD |
| GET/POST | `/api/procurement/rfq` | RFQ CRUD |
| GET/POST | `/api/procurement/purchase-orders` | PO list/create |
| GET/PUT | `/api/procurement/purchase-orders/{id}` | PO detail/update |
| GET/POST | `/api/procurement/grn` | GRN list/create |
| GET/PUT | `/api/procurement/grn/{id}` | GRN detail/update |
| POST | `/api/procurement/requisitions` | Create requisition |
| POST | `/api/procurement/requisitions/{id}/submit` | Submit PR |
| POST | `/api/procurement/requisitions/{id}/convert-to-po` | Convert PR to PO |

---

## Type Definitions

### Budget Types (`src/types/budget.ts`)

```typescript
// Core types
type BudgetSourceType = 'manual' | 'boq' | 'hybrid';
type BudgetStatus = 'draft' | 'approved' | 'locked' | 'closed';
type BudgetHealth = 'healthy' | 'warning' | 'critical';
type TransactionType = 'allocation' | 'adjustment' | 'commitment' |
                       'commitment_reversal' | 'receipt' | 'invoice' | 'payment';

// Entities
interface ProjectBudget { ... }
interface BudgetCategory { ... }
interface BudgetTransaction { ... }
interface BudgetAlert { ... }

// API types
interface BudgetCheckResult { ... }
interface CreateBudgetRequest { ... }
interface AdjustBudgetRequest { ... }
```

See `src/types/budget.ts` for complete definitions.

---

## Related Documentation

- `scripts/migrations/056_budget_tracking.sql` - Budget schema migration
- `scripts/migrations/firebase-to-neon-migration.sql` - BOQ/RFQ schema
- `src/types/budget.ts` - TypeScript type definitions
- `docs/features/03-procurement.md` - Procurement feature docs
- `docs/features/procurement_portal_prd_v_1.md` - Procurement PRD

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-16 | AI Assistant | Initial baseline documentation |

---

*This document serves as the baseline for the Procurement-Budget integration enhancement project. All gaps identified above will be addressed in subsequent phases.*
