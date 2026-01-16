# BOQ to Budget Item Enhancement Specification

> **Document Version:** 1.0
> **Created:** 2026-01-16
> **Status:** Ready for Implementation
> **Priority:** High

---

## Overview

This specification details the enhancement to link BOQ (Bill of Quantities) items directly to budget items, enabling item-level budget tracking instead of category-level only.

---

## Current State (Before Enhancement)

### Data Flow
```
BOQ Items                          Budget Categories
┌─────────────────┐               ┌─────────────────┐
│ boq_items       │               │ budget_categories│
├─────────────────┤               ├─────────────────┤
│ id              │               │ id              │
│ boq_id          │               │ project_budget_id│
│ description     │               │ category_code   │
│ category (text) │──string match─▶│ allocated_amount│
│ quantity        │               │ committed_amount│
│ unit_price      │               │ actual_amount   │
│ total_price     │               └─────────────────┘
└─────────────────┘
```

### Limitations
1. **No direct link** between BOQ items and budget
2. **Category matching** relies on string comparison
3. **No item-level tracking** - only category totals
4. **Cannot track** which specific items consumed budget
5. **No variance analysis** at item level

---

## Target State (After Enhancement)

### Data Flow
```
BOQ Items                    Budget Items                 Budget Categories
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│ boq_items       │         │ budget_items     │         │ budget_categories│
├─────────────────┤         ├──────────────────┤         ├─────────────────┤
│ id              │◀───────▶│ boq_item_id (FK) │         │ id              │
│ boq_id          │         │ budget_category_id│────────▶│ project_budget_id│
│ description     │         │ description      │         │ category_code   │
│ budget_cat_id   │────────▶│ budgeted_amount  │         │ allocated_amount│
│ quantity        │         │ committed_amount │         │ committed_amount│
│ unit_price      │         │ actual_amount    │         │ actual_amount   │
│ total_price     │         │ variance_amount  │         └─────────────────┘
└─────────────────┘         └──────────────────┘
```

### Benefits
1. **Direct FK relationship** between BOQ items and budget
2. **Item-level budget tracking** for granular control
3. **Variance analysis** per item
4. **Better audit trail** of spending by item
5. **Improved reporting** capabilities

---

## Database Schema Changes

### 1. New Table: `budget_items`

```sql
-- Migration: 057_budget_items.sql
-- Description: Add item-level budget tracking linked to BOQ items

CREATE TABLE IF NOT EXISTS budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Parent relationships
    project_budget_id UUID NOT NULL REFERENCES project_budgets(id) ON DELETE CASCADE,
    budget_category_id UUID NOT NULL REFERENCES budget_categories(id) ON DELETE CASCADE,

    -- Source BOQ item (optional - allows manual budget items too)
    boq_item_id UUID REFERENCES boq_items(id) ON DELETE SET NULL,

    -- Item details (copied from BOQ or entered manually)
    item_code VARCHAR(100),
    description TEXT NOT NULL,
    category VARCHAR(100),  -- Denormalized for display

    -- Quantities
    quantity DECIMAL(12,3) NOT NULL DEFAULT 0,
    unit VARCHAR(50),

    -- Budget amounts
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    budgeted_amount DECIMAL(15,2) NOT NULL DEFAULT 0,  -- quantity * unit_price

    -- Tracking amounts (updated by triggers/APIs)
    committed_amount DECIMAL(15,2) DEFAULT 0,  -- From approved POs
    actual_amount DECIMAL(15,2) DEFAULT 0,      -- From completed GRNs

    -- Generated columns
    available_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        GREATEST(0, budgeted_amount - committed_amount)
    ) STORED,
    variance_amount DECIMAL(15,2) GENERATED ALWAYS AS (
        budgeted_amount - actual_amount
    ) STORED,
    variance_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN budgeted_amount > 0
            THEN ROUND(((budgeted_amount - actual_amount) / budgeted_amount * 100)::numeric, 2)
            ELSE 0
        END
    ) STORED,

    -- Metadata
    notes TEXT,
    sort_order INTEGER DEFAULT 0,
    is_manual BOOLEAN DEFAULT false,  -- true if not from BOQ

    -- Audit
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_boq_item_per_budget UNIQUE (project_budget_id, boq_item_id)
);

-- Indexes
CREATE INDEX idx_budget_items_budget_id ON budget_items(project_budget_id);
CREATE INDEX idx_budget_items_category_id ON budget_items(budget_category_id);
CREATE INDEX idx_budget_items_boq_item_id ON budget_items(boq_item_id);
```

### 2. Alter Table: `boq_items`

```sql
-- Add FK to budget_categories for explicit category assignment

DO $$
BEGIN
    -- Add budget_category_id column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'boq_items' AND column_name = 'budget_category_id'
    ) THEN
        ALTER TABLE boq_items ADD COLUMN budget_category_id UUID;

        -- Add FK constraint (nullable - for backward compatibility)
        ALTER TABLE boq_items ADD CONSTRAINT fk_boq_items_budget_category
            FOREIGN KEY (budget_category_id) REFERENCES budget_categories(id)
            ON DELETE SET NULL;
    END IF;
END $$;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_boq_items_budget_category ON boq_items(budget_category_id);
```

### 3. Alter Table: `purchase_order_items`

```sql
-- Link PO items to budget items for granular tracking

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order_items' AND column_name = 'budget_item_id'
    ) THEN
        ALTER TABLE purchase_order_items ADD COLUMN budget_item_id UUID
            REFERENCES budget_items(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_items_budget_item ON purchase_order_items(budget_item_id);
```

---

## API Changes

### 1. Enhanced BOQ Sync Endpoint

**Endpoint:** `POST /api/projects/[projectId]/budget/sync-boq`

**Enhanced Behavior:**
1. Create/update `budget_categories` (existing)
2. **NEW:** Create `budget_items` for each `boq_item`
3. **NEW:** Set `budget_category_id` on each `boq_item`
4. Return item-level breakdown

**Response Addition:**
```json
{
  "budget": { ... },
  "categories": [ ... ],
  "items": [
    {
      "id": "uuid",
      "boqItemId": "uuid",
      "description": "Fiber Cable 24-Core",
      "categoryCode": "MATERIALS",
      "quantity": 5000,
      "unit": "m",
      "unitPrice": 25.50,
      "budgetedAmount": 127500.00
    }
  ],
  "sync": {
    "categoriesUpdated": 5,
    "itemsCreated": 42
  }
}
```

### 2. New Budget Items Endpoint

**Endpoint:** `GET /api/projects/[projectId]/budget/items`

**Query Parameters:**
- `categoryId` - Filter by category
- `boqItemId` - Filter by BOQ item
- `search` - Search description
- `sortBy` - Sort field
- `sortOrder` - asc/desc

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "boqItemId": "uuid",
        "budgetCategoryId": "uuid",
        "categoryCode": "MATERIALS",
        "categoryName": "Materials & Consumables",
        "itemCode": "FC-24",
        "description": "Fiber Cable 24-Core",
        "quantity": 5000,
        "unit": "m",
        "unitPrice": 25.50,
        "budgetedAmount": 127500.00,
        "committedAmount": 50000.00,
        "actualAmount": 25000.00,
        "availableAmount": 77500.00,
        "varianceAmount": 102500.00,
        "variancePercent": 80.39
      }
    ],
    "totals": {
      "budgeted": 500000.00,
      "committed": 150000.00,
      "actual": 75000.00,
      "available": 350000.00
    }
  }
}
```

### 3. Budget Check Enhancement

**Endpoint:** `POST /api/budget/check`

**New Request Field:**
```json
{
  "projectId": "uuid",
  "amount": 5000.00,
  "categoryId": "uuid",
  "budgetItemId": "uuid"  // NEW: Check at item level
}
```

**Enhanced Response:**
```json
{
  "allowed": true,
  "reason": "ok",
  "available": 77500.00,
  "requested": 5000.00,
  "itemLevel": {
    "itemDescription": "Fiber Cable 24-Core",
    "itemBudget": 127500.00,
    "itemCommitted": 50000.00,
    "itemAvailable": 77500.00
  },
  "categoryLevel": {
    "categoryName": "Materials & Consumables",
    "categoryAllocated": 200000.00,
    "categoryCommitted": 80000.00,
    "categoryAvailable": 120000.00
  }
}
```

---

## TypeScript Types

### New Types (`src/types/budget.ts`)

```typescript
/**
 * Budget Item - Individual line item within budget
 */
export interface BudgetItem {
  id: string;
  projectBudgetId: string;
  budgetCategoryId: string;
  boqItemId?: string;

  // Item details
  itemCode?: string;
  description: string;
  category?: string;

  // Quantities
  quantity: number;
  unit?: string;
  unitPrice: number;

  // Amounts
  budgetedAmount: number;
  committedAmount: number;
  actualAmount: number;
  availableAmount: number;
  varianceAmount: number;
  variancePercent: number;

  // Metadata
  notes?: string;
  sortOrder: number;
  isManual: boolean;

  // Audit
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Budget Item with category info (for display)
 */
export interface BudgetItemWithCategory extends BudgetItem {
  categoryCode: string;
  categoryName: string;
}

/**
 * Request to create budget item
 */
export interface CreateBudgetItemRequest {
  budgetCategoryId: string;
  boqItemId?: string;
  itemCode?: string;
  description: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  notes?: string;
}

/**
 * Budget items list response
 */
export interface BudgetItemsResponse {
  items: BudgetItemWithCategory[];
  totals: {
    budgeted: number;
    committed: number;
    actual: number;
    available: number;
  };
}
```

---

## Component Changes

### 1. New Component: `BudgetItemsTable`

**Location:** `src/components/budget/BudgetItemsTable.tsx`

**Features:**
- Sortable columns
- Filter by category
- Search by description
- Show variance indicators
- Expandable rows for details

### 2. Enhanced: `CategoryBreakdownTable`

**Changes:**
- Add "View Items" action per category
- Show item count per category
- Drill-down to items view

### 3. Enhanced: Budget Dashboard

**Changes:**
- Add "Items" tab alongside "Categories"
- Show top items by variance
- Show items over budget

---

## BOQ Import Process Enhancement

### Current Import Flow
```
Excel/CSV → Parse → Create boq_items → Done
```

### Enhanced Import Flow
```
Excel/CSV
    │
    ▼
Parse Columns
    │
    ├─ Map "Category" column to budget category
    │
    ▼
Create boq_items with budget_category_id
    │
    ▼
(On BOQ Approval + Budget Sync)
    │
    ▼
Create budget_items linked to boq_items
```

### Category Mapping in Import

**Excel Column:** `Category` or `Cost Category`

**Auto-Mapping Rules:**
| Excel Value (case-insensitive) | Budget Category |
|-------------------------------|-----------------|
| material*, consumable* | MATERIALS |
| equipment*, tool*, plant* | EQUIPMENT |
| labo*r, workforce* | LABOR |
| subcontract*, sub-contract* | SUBCONTRACT |
| transport*, logistic*, delivery* | TRANSPORT |
| overhead*, admin*, management* | OVERHEAD |
| contingency*, reserve*, provisional* | CONTINGENCY |

**UI Enhancement:**
- Show category preview during import
- Allow manual override per row
- Validate all categories assigned before save

---

## Triggers and Functions

### Update Budget Item on PO Item

```sql
CREATE OR REPLACE FUNCTION update_budget_item_on_po()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_po RECORD;
BEGIN
    -- Get parent PO
    SELECT * INTO v_po FROM purchase_orders WHERE id = NEW.purchase_order_id;

    -- Only if budget item linked and PO is approved
    IF NEW.budget_item_id IS NOT NULL AND v_po.status = 'approved' THEN
        UPDATE budget_items
        SET committed_amount = committed_amount + NEW.total_price,
            updated_at = NOW()
        WHERE id = NEW.budget_item_id;
    END IF;

    RETURN NEW;
END;
$$;
```

### Update Budget Item on GRN Item

```sql
CREATE OR REPLACE FUNCTION update_budget_item_on_grn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_po_item RECORD;
BEGIN
    -- Get PO item to find budget item
    SELECT * INTO v_po_item
    FROM purchase_order_items
    WHERE id = NEW.purchase_order_item_id;

    IF v_po_item.budget_item_id IS NOT NULL THEN
        UPDATE budget_items
        SET actual_amount = actual_amount + NEW.received_amount,
            updated_at = NOW()
        WHERE id = v_po_item.budget_item_id;
    END IF;

    RETURN NEW;
END;
$$;
```

---

## Migration Strategy

### Phase 1: Schema Only (Non-Breaking)
1. Run migration to create `budget_items` table
2. Add `budget_category_id` to `boq_items` (nullable)
3. Add `budget_item_id` to `purchase_order_items` (nullable)
4. No existing functionality affected

### Phase 2: Backfill Existing Data
1. For each project with approved BOQ + budget:
   - Create `budget_items` from existing `boq_items`
   - Set `budget_category_id` on `boq_items` via category matching
2. Verify data integrity

### Phase 3: Enable New Features
1. Deploy enhanced sync-boq endpoint
2. Deploy budget items API
3. Deploy UI components
4. Update BOQ import process

### Phase 4: Deprecation
1. Mark old category-only sync as deprecated
2. Migrate remaining projects
3. Make `budget_category_id` required on new BOQ items

---

## Testing Plan

### Unit Tests
- [ ] Budget item CRUD operations
- [ ] Category assignment validation
- [ ] Amount calculations (budgeted, committed, actual)
- [ ] Variance calculations

### Integration Tests
- [ ] BOQ sync creates budget items
- [ ] PO approval updates budget item committed
- [ ] GRN completion updates budget item actual
- [ ] Budget check at item level

### E2E Tests
- [ ] Import BOQ → Assign categories → Sync budget → View items
- [ ] Create PO with item link → Approve → Verify tracking
- [ ] Complete GRN → Verify actual updated

---

## Success Criteria

1. **Item-Level Visibility:** Users can see budget status per BOQ item
2. **Accurate Tracking:** Committed and actual amounts update automatically
3. **Variance Analysis:** Users can identify items over/under budget
4. **Import Integration:** BOQ import assigns categories correctly
5. **Backward Compatible:** Existing projects continue working

---

## Related Files

### To Create
- `scripts/migrations/057_budget_items.sql`
- `src/types/budget-items.ts`
- `src/components/budget/BudgetItemsTable.tsx`
- `pages/api/projects/[projectId]/budget/items.ts`

### To Modify
- `pages/api/projects/[projectId]/budget/sync-boq.ts`
- `pages/api/budget/check.ts`
- `src/types/budget.ts`
- `src/components/budget/CategoryBreakdownTable.tsx`
- `pages/projects/[id]/budget.tsx`

---

## Next Steps

1. Review and approve this specification
2. Create migration file
3. Implement API changes
4. Build UI components
5. Update BOQ import
6. Test thoroughly
7. Deploy to staging
8. User acceptance testing
9. Deploy to production

---

*This specification is ready for implementation once approved.*
