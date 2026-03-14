# BOQ Spend vs Budget Dashboard

**Module:** Procurement  
**Component:** `BOQSpendSummary`  
**API Endpoint:** `GET /api/procurement/boq-spend-summary`  
**Introduced:** 2026-03-10 (commit e8ac4dd)  
**Status:** Production  

---

## Overview

The **BOQ Spend vs Budget Dashboard** provides cross-project visibility into procurement spend against approved Bill of Quantities (BOQ) budgets. It helps Project Managers and Finance teams:

- Track total ordered vs confirmed spend across all active projects
- Identify over-budget projects at a glance
- Monitor budget utilization and remaining capacity
- Drill into per-project spend breakdowns

This dashboard is located on the **Procurement → Dashboard → Reports** tab.

---

## Key Features

### 1. **KPI Cards (Portfolio-Level)**
Four summary cards at the top show totals across all projects with active BOQs:

- **Total BOQ Budget** — Sum of all active BOQ values + project count
- **Total Ordered** — Sum of all PO line items (all statuses) + % of budget
- **Confirmed Spend** — Sum of PO line items with status `received`, `partially_received`, `invoiced`, or `paid` + % of budget
- **Remaining Budget** — Unallocated budget (Budget - Ordered) + % unallocated

### 2. **Overall Progress Bar**
Visual representation of portfolio-wide spend:
- **Green bar** = Confirmed spend
- **Purple bar** = Ordered (but not yet confirmed)
- **Red background** = Over-budget alert (when ordered > budget)

### 3. **Per-Project Breakdown Table**
Each row shows:
- **Project Name** + BOQ version
- **BOQ Budget** (ZAR)
- **Ordered** (ZAR + % of budget)
- **Confirmed** (ZAR + % of budget)
- **Remaining** (ZAR)
- **PO Count** — Number of purchase orders issued for this project
- **Progress bar** — Same color coding as portfolio bar

**Over-budget projects** are flagged with:
- Red warning icon (⚠️)
- Red-tinted progress bar
- Bold text for ordered amount

---

## API Details

### Endpoint
```
GET /api/procurement/boq-spend-summary
```

**Authentication:** Required (session-based)  
**Permissions:** Any authenticated user with access to procurement module  
**Method:** GET  
**Response Format:** JSON  

### Response Schema
```typescript
{
  success: true,
  data: {
    projects: [
      {
        projectId: string,
        projectName: string,
        boqId: string,
        boqVersion: string,
        boqLineCount: number,
        boqValue: number,          // Total BOQ budget (ZAR)
        totalOrdered: number,       // All PO line items (ZAR)
        confirmedSpend: number,     // PO items with status in [received, partially_received, invoiced, paid]
        remainingBudget: number,    // Max(0, boqValue - totalOrdered)
        orderedPercent: number,     // (totalOrdered / boqValue) * 100
        confirmedPercent: number,   // (confirmedSpend / boqValue) * 100
        poCount: number             // Number of POs for this project
      }
    ],
    totals: {
      boqValue: number,
      totalOrdered: number,
      confirmedSpend: number
    }
  }
}
```

### SQL Logic
The endpoint queries:
- **Projects table** — All projects with active BOQs
- **BOQ items** — Sum of `unit_price * quantity` for BOQ value
- **Purchase order items** — Sum of `total_price` for ordered and confirmed spend

**Confirmed Spend Criteria:**  
PO status must be one of: `received`, `partially_received`, `invoiced`, `paid`

**Sorting:**  
Projects are sorted by BOQ value (descending) — largest projects first.

---

## Use Cases

### 1. **Budget Oversight (Finance)**
- Quickly identify which projects are approaching or exceeding budget
- Monitor confirmed vs ordered spend to forecast cash flow
- Export to CSV for financial reporting (future enhancement)

### 2. **Procurement Planning (PM/Procurement)**
- See remaining budget capacity before issuing new POs
- Prioritize procurement for under-ordered projects
- Track PO count to gauge procurement activity

### 3. **Executive Reporting (Leadership)**
- Portfolio-wide spend visibility in one view
- Flag high-risk over-budget projects
- Monitor procurement efficiency (confirmed vs ordered ratio)

---

## Component Details

**File:** `src/modules/procurement/reports/BOQSpendSummary.tsx`

### Key UI Elements
- **Loader State** — Animated spinner while loading
- **Error State** — Red alert box if API fails
- **Empty State** — "No active BOQs found" if no data
- **Progress Bars** — Custom `ProgressBar` component with dual-layer visualization (confirmed = green, ordered = purple)
- **Currency Formatting** — South African Rand (ZAR) with no decimals via `Intl.NumberFormat`

### Over-Budget Visual Indicators
When `totalOrdered > boqValue`:
- Progress bar background changes from gray to light red
- Ordered portion of bar turns red (instead of purple)
- Warning icon appears next to project name (future enhancement)

---

## Future Enhancements

Potential improvements identified:
1. **CSV Export** — Export table to spreadsheet
2. **Date Range Filter** — Limit to POs within specific date range
3. **Expandable PO Details** — Click row to see PO line items (already exists in separate feature commit a8978ad)
4. **Budget Alerts** — Email notifications when project exceeds 80% or 100% of budget
5. **Historical Trends** — Track spend over time (weekly/monthly snapshots)
6. **Variance Analysis** — Compare BOQ estimates to actual spend by category

---

## Related Features

- **Procurement Approvals** — View approval status tabs (pending, approved, rejected)  
  See: `docs/modules/procurement/approvals.md`
- **BOQ Management** — Upload and activate project BOQs  
  See: `docs/modules/procurement/boq.md`
- **Purchase Orders** — Create and manage POs  
  See: `docs/modules/procurement/purchase-orders.md`

---

## Troubleshooting

**Dashboard shows "No active BOQs found"**  
→ Ensure at least one project has a BOQ with `status = 'active'`. Check via:
```sql
SELECT project_id, version, status FROM boqs WHERE status = 'active';
```

**Spend values seem incorrect**  
→ Verify PO line items have `total_price` populated:
```sql
SELECT po.id, poi.total_price, po.status 
FROM purchase_orders po 
JOIN purchase_order_items poi ON poi.purchase_order_id = po.id 
WHERE po.project_id = 'PROJECT_ID';
```

**Over-budget alert when it shouldn't be**  
→ Check if draft/cancelled POs are included in the ordered total. Current logic sums ALL PO items regardless of status. Consider filtering by `po.status NOT IN ('draft', 'cancelled')` if needed.

---

## Database Schema References

**Tables Used:**
- `projects` — Project metadata
- `boqs` — Bill of Quantities (budget)
- `boq_items` — Line items in BOQ
- `purchase_orders` — PO headers
- `purchase_order_items` — PO line items (linked to BOQ items)

**Key Columns:**
- `boqs.status` — Must be `'active'` to appear in dashboard
- `purchase_orders.status` — Determines if spend is "confirmed"
- `boq_items.unit_price` and `quantity` — Determines budget value
- `purchase_order_items.total_price` — Determines ordered/confirmed spend

---

## Testing Checklist

- [ ] Dashboard loads without errors for user with procurement access
- [ ] KPI cards show correct totals across all active BOQ projects
- [ ] Progress bars render correctly for normal and over-budget projects
- [ ] Over-budget projects display red visual indicators
- [ ] Empty state shows when no active BOQs exist
- [ ] Error state shows gracefully if API fails
- [ ] Currency formatting displays ZAR with no decimals
- [ ] Projects sort by BOQ value (largest first)
- [ ] Confirmed spend only counts POs with status in [received, partially_received, invoiced, paid]

---

**Last Updated:** 2026-03-10 (Scribe)  
**Commit Reference:** e8ac4dd  
**Author:** Claude Sonnet 4.5  
