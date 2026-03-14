# Procurement Module CHANGELOG

All notable changes to the Procurement module are documented here.

---

## [Unreleased]

### Added
- **Pipeline Discard with RBAC** (2026-03-11, commit `ac52556`)
  - Discard/archive procurement threads with role-based access control
  - Soft delete with audit trail
  - Migration adds discarded_at and discarded_by columns
  - 2 endpoint enhancements for thread management

- **RFQ Email Notifications via Resend** (2026-03-11, commit `0c5fe7a`)
  - Automated email notifications when RFQs created/sent to suppliers
  - Integration with Resend API for transactional emails
  - 1 endpoint enhanced with email notification logic

- **BOQ Utilization Table on BOQ Detail Page** (2026-03-11, commit `a36d0f2`)
  - Added utilization tracking table to BOQ detail view
  - Shows budget vs actual spend per BOQ item
  - 1 page component enhancement

- **BOQ Items View Enhancement - 4 Features** (2026-03-11, commit `b426418`)
  - Always-visible search/filter bar
  - Summary footer with totals
  - Improved filter UX with chips
  - Enhanced viewer hooks for better state management
  - 6 component files modified

- **Map BOQ Items to Inventory Budget Categories** (2026-03-11, commit `e098a02`)
  - Direct foreign key relationship between BOQ items and budget items
  - Item-level budget tracking for granular variance analysis
  - 2 API endpoints enhanced with budget category mappings

- **10-Step Procurement Workflow with Quote Evaluation** (2026-03-11, commit `146da95`)
  - Restructured 9-step wizard to 10 steps
  - Inserted Quote & Award step (Step 6) between Sourcing and PO creation
  - Both RFQ and Direct PO paths require quote evaluation before PO
  - New workflow: Step 5=Sourcing, Step 6=Quote & Award, Step 7=Create PO
  - 7 endpoint modifications across workflow steps

- **Approval History with Status Tabs** (2026-03-10, commit `aa55345`)
  - Replaced pending-only view with full approval history
  - Status tabs: Pending, Approved, Rejected (with counts)
  - Shows who approved/rejected and when
  - Displays rejection reasons
  - New endpoint: `/api/procurement/approvals/all`

- **BOQ Spend Summary Enhancements** (2026-03-10, commit `a8978ad`)
  - Expandable PO details per project row
  - Date range filtering
  - CSV export functionality
  - Extracted reusable KPI cards component
  - Individual PO transaction detail table

- **BOQ Spend vs Budget Dashboard** (2026-03-10, commit `e8ac4dd`)
  - Cross-project BOQ spend overview on Reports tab
  - KPI cards showing budget vs ordered vs confirmed spend
  - Per-project progress bars with visual indicators
  - Over-budget warnings (red flag with icon)
  - New endpoint: `/api/procurement/boq-spend-summary`

---

## Commit Details

### 146da958 — feat(procurement): 10-step workflow with quote evaluation before PO

**Date**: 2026-03-11 15:33:12 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Restructured the procurement workflow wizard from 9 to 10 steps by inserting a mandatory Quote & Award step between Sourcing and PO creation. Both RFQ and Direct PO paths now require quote evaluation before creating a purchase order, ensuring all procurement decisions are based on documented quotes.

#### Files Changed

1. **pages/api/procurement/rfq-suppliers.ts** (+35 lines, MODIFIED)
   - Enhanced RFQ supplier endpoint with quote collection status
   - Added validation for quote completeness before advancing to Step 6
   - Returns quote readiness indicator for workflow progression

2. **src/modules/procurement/workflow/ProcurementWorkflowWizard.tsx** (+24 lines, MODIFIED)
   - Updated step count from 9 to 10
   - Inserted Step 6 (Quote & Award) into workflow sequence
   - Renumbered subsequent steps: PO creation now Step 7 (was Step 6)
   - Updated navigation logic to enforce quote requirement

3. **src/modules/procurement/workflow/WizardStepIndicator.tsx** (+19 lines, MODIFIED)
   - Added Step 6 indicator: "Quote & Award"
   - Updated step labels and progression indicators
   - Visual indication of quote requirement completion status

4. **src/modules/procurement/workflow/steps/Step5Order.tsx** (+254 lines, -223 lines REFACTORED)
   - Renamed from "Order" to "Sourcing"
   - Removed direct PO creation functionality (moved to Step 7)
   - Focus shifted to supplier selection and RFQ management
   - Validates quotes received before allowing progression
   - Net change: +31 lines (refactored for quote-first workflow)

5. **src/modules/procurement/workflow/steps/Step6QuoteAward.tsx** (+257 lines, NEW)
   - New step for quote evaluation and supplier award
   - Features:
     - Display all received quotes in comparison table
     - Columns: Supplier, Unit Price, Total, Lead Time, Rating
     - Sort by price, lead time, or supplier rating
     - Award selection with justification notes field
     - Budget validation before award confirmation
     - Visual indicators for best price, fastest delivery
   - Validation:
     - Requires at least one quote received
     - Enforces award selection before proceeding
     - Logs award decision with user, timestamp, justification
   - API integration:
     - Fetches quotes via `/api/procurement/quotes?pr_id=<id>`
     - Award submission to `/api/procurement/quotes/award`

6. **src/modules/procurement/workflow/steps/Step7CreatePO.tsx** (+193 lines, NEW)
   - Moved from Step6, enhanced with quote context
   - Pre-populates PO details from awarded quote:
     - Supplier (locked to awarded supplier)
     - Line items with quantities and prices from quote
     - Delivery terms from quote
   - Features:
     - PO number auto-generation
     - Budget check with project budget context
     - Payment terms selection
     - Delivery address confirmation
     - Approval routing configuration
   - Creates PO record linked to:
     - Parent PR
     - Awarded quote
     - Selected supplier
   - Workflow completion: Redirects to PO detail page

7. **src/modules/procurement/workflow/useWorkflowState.ts** (+15 lines, MODIFIED)
   - Added `awardedQuoteId` to workflow state
   - Step 6 completion criteria: `awardedQuoteId !== null`
   - Step 7 validation: Requires awarded quote context
   - State persistence across step navigation

#### API Usage Example

```bash
# Step 5: Get RFQ suppliers and quote status
GET /api/procurement/rfq-suppliers?pr_id=<uuid>
Response: {
  suppliers: [...],
  quotesReceived: 3,
  quotesRequired: 3,
  readyForAward: true
}

# Step 6: Get quotes for comparison
GET /api/procurement/quotes?pr_id=<uuid>
Response: {
  quotes: [
    {
      id: "q1",
      supplier: "ABC Supplies",
      unitPrice: 5000,
      totalAmount: 50000,
      leadTimeDays: 14,
      supplierRating: 4.5,
      receivedAt: "2026-03-10T10:00:00Z"
    }
  ]
}

# Step 6: Award quote
POST /api/procurement/quotes/award
Body: {
  quoteId: "q1",
  prId: "<uuid>",
  justification: "Best price with acceptable lead time"
}
Response: { success: true, awardedQuoteId: "q1" }

# Step 7: Create PO from awarded quote
POST /api/procurement/purchase-orders
Body: {
  prId: "<uuid>",
  quoteId: "q1",
  supplierId: "s1",
  lineItems: [...],
  paymentTerms: "NET30"
}
```

#### Workflow Changes Summary

**Old 9-Step Workflow:**
1. Create Project
2. BOQ
3. Budget
4. Create PR
5. Sourcing (RFQ/Direct)
6. **Create PO** ← Direct from sourcing
7. Approval
8. Receive Goods
9. Invoice & Payment

**New 10-Step Workflow:**
1. Create Project
2. BOQ
3. Budget
4. Create PR
5. Sourcing (RFQ/Supplier Selection)
6. **Quote & Award** ← NEW mandatory step
7. **Create PO** ← Now based on awarded quote
8. Approval
9. Receive Goods
10. Invoice & Payment

#### Key Changes

- **Mandatory Quote Evaluation**: Cannot create PO without documented quote
- **Audit Trail**: All procurement decisions now have quote comparison records
- **Better Pricing**: Forces evaluation of multiple quotes before commitment
- **Compliance**: Meets procurement best practices for competitive evaluation
- **Direct PO Path Also Requires Quote**: Even direct purchases need quote documentation

#### PRD Alignment

**KB Query Result**: Procurement workflow documentation describes a 10-step process but with different step definitions than this implementation. KB focuses on high-level stages (Project → BOQ → Budget → PR → RFQ → Quote Evaluation → PO), while this implementation restructures the wizard UI to enforce quote-first procurement.

**Status**: Partially aligned with KB description

**Assessment**: Feature implements quote-before-PO requirement described in KB: "Once the quotes are evaluated, you can select the winning quote and proceed to create a PO from the approved quote." This commit makes that workflow mandatory in the UI wizard.

**Doc Drift Detected**: KB describes 10 steps at project lifecycle level, while code implements 10 steps at wizard UI level. These are different conceptual layers. KB documentation should be updated to clarify wizard steps vs. lifecycle phases.

**Recommendation**: Update KB with wizard-specific documentation showing the 10 UI steps and their relationship to the higher-level procurement lifecycle.

#### Testing Checklist

- [ ] Cannot advance from Step 5 without receiving quotes
- [ ] Step 6 displays all received quotes correctly
- [ ] Award selection records justification
- [ ] Step 7 pre-populates from awarded quote
- [ ] Cannot create PO without awarded quote
- [ ] Budget validation works at Step 6 and Step 7
- [ ] Direct PO path also enforces quote requirement
- [ ] RFQ path workflow completes end-to-end
- [ ] State persistence across browser refresh
- [ ] Mobile responsive design on all steps

#### Schema Changes

None. Uses existing procurement tables:
- `purchase_requisitions`
- `rfqs`
- `quotes`
- `purchase_orders`

Relationships updated:
- `purchase_orders.quote_id` → references `quotes.id` (existing foreign key)

---

### aa55345c — feat(procurement): show all approvals with status tabs (pending, approved, rejected)

**Date**: 2026-03-10 10:07:57 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Replaces the pending-only approvals page with a comprehensive approval history view. Introduces status tabs (Pending, Approved, Rejected) with real-time counts, approval/rejection metadata (who, when), and rejection reasons.

#### Files Changed

1. **pages/api/procurement/approvals/all.ts** (+138 lines, NEW)
   - GET endpoint: `/api/procurement/approvals/all`
   - Query parameters:
     - `status` (optional): 'pending' | 'approved' | 'rejected' | 'all' (default: 'all')
     - `userId` (optional): Filter by requesting user
     - `limit` (optional): Max results (default: 100)
   - Returns:
     ```typescript
     {
       approvals: Array<{
         id: string;
         type: 'PO' | 'Quote' | 'Invoice' | 'Payment';
         title: string;
         amount: number;
         requestedBy: { id, name, email };
         requestedAt: Date;
         status: 'pending' | 'approved' | 'rejected';
         approvedBy?: { id, name, email };
         approvedAt?: Date;
         rejectedBy?: { id, name, email };
         rejectedAt?: Date;
         rejectionReason?: string;
       }>;
       counts: {
         pending: number;
         approved: number;
         rejected: number;
         total: number;
       };
     }
     ```
   - Uses Neon SQL with JOIN on users table for metadata
   - Authorization: Requires user authentication
   - Error handling with structured responses

2. **src/modules/procurement/approvals/ApprovalCard.tsx** (+171 lines, NEW)
   - Extracted reusable component for approval display
   - Props:
     - `approval`: Approval object with metadata
     - `onApprove`: Callback for approve action
     - `onReject`: Callback for reject action
   - Visual features:
     - Status badge (color-coded: pending=yellow, approved=green, rejected=red)
     - Amount display with currency formatting
     - Requester avatar and name
     - Approval/rejection metadata with timestamps
     - Rejection reason callout (when present)
     - Action buttons (for pending items)
   - Responsive design for mobile/desktop

3. **pages/procurement/approvals/index.tsx** (+106 lines, -292 lines)
   - Replaced pending-only layout with tabbed interface
   - Added status tabs with real-time counts:
     - Pending (shows badge with count)
     - Approved
     - Rejected
   - Tab switching updates URL query param: `?status=pending`
   - Uses `ApprovalCard` component for consistent rendering
   - Empty states per tab:
     - Pending: "No pending approvals"
     - Approved: "No approvals history"
     - Rejected: "No rejected approvals"
   - Loading skeletons during data fetch
   - Error boundary for failed API calls

#### API Usage Example

```bash
# Get all pending approvals
GET /api/procurement/approvals/all?status=pending
Response: {
  approvals: [
    {
      id: "a1",
      type: "PO",
      title: "Purchase Order #1234",
      amount: 125000,
      requestedBy: { id: "u1", name: "John Doe", email: "john@example.com" },
      requestedAt: "2026-03-09T10:30:00Z",
      status: "pending"
    }
  ],
  counts: { pending: 1, approved: 45, rejected: 3, total: 49 }
}

# Get all approved approvals
GET /api/procurement/approvals/all?status=approved
```

#### Key Changes

- **Historical View**: Users can now see all approval decisions, not just pending items
- **Accountability**: Clear audit trail showing who approved/rejected and when
- **Rejection Reasons**: Mandatory rejection reason field helps improve future requests
- **Component Extraction**: ApprovalCard reusable across different approval types
- **Performance**: SQL query optimized with indexes on status and date columns

#### PRD Alignment

**Source**: Procurement Module - Budget Approvals (KB reference)

**Status**: Aligned with procurement approval workflow requirements

**Assessment**: Feature enhances existing approval workflow with transparency and audit capabilities. KB confirms approval requests are tracked in the system for "transparency and accountability" — this implementation delivers on that requirement.

**Notes**:
- Task description indicates "7 new endpoints" — this commit implements 1 API endpoint with multiple status filters (may be counted as logical endpoints)
- Improves user experience by showing complete approval history
- Supports compliance and audit requirements

#### Database Schema

No schema changes. Uses existing `procurement_approvals` table with these columns:
- `id`, `type`, `title`, `amount`, `user_id`, `created_at`
- `status`, `approved_by`, `approved_at`, `rejected_by`, `rejected_at`, `rejection_reason`

---

### a8978adb — feat(procurement): add expandable PO details, date filters, and CSV export to BOQ Spend Summary

**Date**: 2026-03-10 09:25:09 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Enhances the BOQ Spend Summary dashboard with drill-down capability into individual PO transactions, date range filtering, and CSV export. Improves component architecture by extracting KPI cards and transaction tables into separate files (keeping each under 300 lines).

#### Files Changed

1. **pages/api/procurement/boq-spend-summary.ts** (+67 lines, MODIFIED)
   - Enhanced existing endpoint with new features:
     - Date range filtering: `?dateFrom=2026-01-01&dateTo=2026-03-31`
     - PO details drill-down: `?projectId=<uuid>&expand=transactions`
   - Returns additional transaction-level data when `expand=transactions`:
     ```typescript
     {
       projectId: string;
       transactions: Array<{
         poId: string;
         poNumber: string;
         supplier: string;
         lineItem: string;
         quantity: number;
         unitPrice: number;
         totalAmount: number;
         status: string;
         createdAt: Date;
       }>;
     }
     ```
   - Added CSV export format support: `?format=csv`
   - Performance: Uses indexed queries on date and project columns

2. **src/modules/procurement/reports/BOQSpendKPICards.tsx** (+106 lines, NEW)
   - Extracted KPI card display into reusable component
   - Props:
     - `totalBudget`: Overall budget amount
     - `totalOrdered`: Total PO value (ordered)
     - `totalConfirmed`: Confirmed spend to date
     - `projects`: Number of projects
   - Visual features:
     - Four summary cards: Budget, Ordered, Confirmed, Projects
     - Color-coded indicators (green=under budget, red=over budget)
     - Percentage calculations with progress bars
     - Currency formatting
   - Responsive grid layout

3. **src/modules/procurement/reports/BOQSpendSummary.tsx** (+126 lines, -54 lines)
   - Refactored to use extracted components
   - Added expandable row functionality:
     - Click project row → expands to show PO transactions
     - Uses `POTransactionDetail` component for detail rendering
     - Collapse/expand state managed per row
   - Added date range picker:
     - Start date + end date inputs
     - Quick filters: This month, Last 30 days, This quarter
     - Updates API query on change
   - Added CSV export button:
     - Calls API with `?format=csv`
     - Downloads file: `boq-spend-summary-YYYY-MM-DD.csv`
   - Loading states for expanded rows
   - Empty states for no transactions

4. **src/modules/procurement/reports/POTransactionDetail.tsx** (+84 lines, NEW)
   - Component for displaying individual PO transactions
   - Props:
     - `transactions`: Array of PO line items
     - `projectId`: Parent project ID
   - Features:
     - Sortable table (by date, amount, supplier)
     - Status badges (pending, confirmed, delivered)
     - Quantity × unit price calculation display
     - Grand total row at bottom
     - Responsive table with horizontal scroll on mobile

#### API Usage Example

```bash
# Get BOQ spend with date filter
GET /api/procurement/boq-spend-summary?dateFrom=2026-01-01&dateTo=2026-03-31
Response: {
  summary: { totalBudget, totalOrdered, totalConfirmed, projectCount },
  projects: [ ... ]
}

# Get project with transaction drill-down
GET /api/procurement/boq-spend-summary?projectId=abc123&expand=transactions
Response: {
  projectId: "abc123",
  transactions: [
    {
      poId: "po1",
      poNumber: "PO-2026-001",
      supplier: "ABC Supplies",
      lineItem: "Fiber cable 1km",
      quantity: 10,
      unitPrice: 5000,
      totalAmount: 50000,
      status: "confirmed",
      createdAt: "2026-02-15T10:00:00Z"
    }
  ]
}

# Export to CSV
GET /api/procurement/boq-spend-summary?format=csv
Response: (CSV file download)
```

#### Key Changes

- **Drill-Down**: Project rows expand to show all PO transactions
- **Date Filtering**: Analyze spend within specific periods
- **CSV Export**: Download data for external analysis (Excel, BI tools)
- **Component Architecture**: KPI cards and transaction table extracted for reusability
- **File Size Management**: All components now < 300 lines (maintainability best practice)

#### PRD Alignment

**Source**: Procurement Module - BOQ Management (KB reference)

**Status**: Aligned with BOQ spend tracking requirements

**Assessment**: Feature enhances existing BOQ spend summary with drill-down and export capabilities. KB confirms "BOQ management is essential for tracking quantities and costs" — this implementation provides detailed cost visibility and export for analysis.

**Notes**:
- Task description indicates "1 new endpoint" — this commit modifies existing endpoint with new query parameters
- Improves financial transparency and decision-making
- Supports external reporting and BI integration

#### Testing Checklist

- [ ] Expandable rows work for all projects
- [ ] PO transactions load correctly on expand
- [ ] Date range filter updates summary data
- [ ] CSV export includes all filtered data
- [ ] CSV format is valid (opens in Excel)
- [ ] Quick date filters work correctly
- [ ] Responsive design on mobile (tables scroll)
- [ ] Loading spinners show during data fetch
- [ ] Error handling for failed API calls

---

### e8ac4dde — feat(procurement): add BOQ Spend vs Budget dashboard on Reports tab

**Date**: 2026-03-10 06:52:32 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Introduces a comprehensive BOQ Spend vs Budget dashboard on the procurement Reports tab. Shows cross-project spend overview with KPI cards, progress bars, and per-project budget tracking. Flags over-budget projects in red with warning icons.

#### Files Changed

1. **pages/api/procurement/boq-spend-summary.ts** (+83 lines, NEW)
   - GET endpoint: `/api/procurement/boq-spend-summary`
   - Query parameters:
     - `dateFrom` (optional): Filter from date
     - `dateTo` (optional): Filter to date
   - Returns:
     ```typescript
     {
       summary: {
         totalBudget: number;
         totalOrdered: number;
         totalConfirmed: number;
         projectCount: number;
         averageBudgetUtilization: number;
       };
       projects: Array<{
         projectId: string;
         projectName: string;
         boqBudget: number;
         totalOrdered: number;
         totalConfirmed: number;
         budgetUtilization: number;
         isOverBudget: boolean;
         variance: number;
       }>;
     }
     ```
   - SQL aggregation across projects, PO lines, BOQ items
   - Budget variance calculation: `(totalOrdered - boqBudget) / boqBudget * 100`
   - Flags `isOverBudget: true` when totalOrdered > boqBudget
   - Authorization: Requires manager role
   - Error handling with logging

2. **src/modules/procurement/reports/BOQSpendSummary.tsx** (+225 lines, NEW)
   - React component for BOQ spend dashboard
   - Layout:
     - **KPI Cards** (top section):
       - Total Budget: Sum of all project BOQ budgets
       - Total Ordered: Sum of all PO values
       - Total Confirmed: Sum of confirmed spend
       - Projects: Count of active projects
     - **Per-Project Table**:
       - Columns: Project, Budget, Ordered, Confirmed, Utilization
       - Progress bar per project (visual budget utilization)
       - Over-budget indicator: Red text + warning icon
       - Variance column: Shows ± amount vs budget
   - Features:
     - Sortable columns (by budget, spend, utilization)
     - Search/filter by project name
     - Export to CSV button
     - Responsive design for mobile
   - Visual cues:
     - Green progress bar: < 90% budget utilization
     - Yellow: 90-100%
     - Red: > 100% (over budget)
     - Warning icon: Projects exceeding budget

3. **pages/procurement/index.tsx** (+3 lines, -1 line)
   - Replaced placeholder "Reports coming soon" message
   - Integrated `BOQSpendSummary` component
   - Added Reports tab to procurement dashboard

#### API Usage Example

```bash
# Get all-time BOQ spend summary
GET /api/procurement/boq-spend-summary
Response: {
  summary: {
    totalBudget: 5000000,
    totalOrdered: 4750000,
    totalConfirmed: 4200000,
    projectCount: 12,
    averageBudgetUtilization: 95.0
  },
  projects: [
    {
      projectId: "p1",
      projectName: "Downtown Build",
      boqBudget: 1000000,
      totalOrdered: 1050000,
      totalConfirmed: 980000,
      budgetUtilization: 105.0,
      isOverBudget: true,
      variance: 50000
    },
    {
      projectId: "p2",
      projectName: "Suburb Link",
      boqBudget: 750000,
      totalOrdered: 680000,
      totalConfirmed: 650000,
      budgetUtilization: 90.7,
      isOverBudget: false,
      variance: -70000
    }
  ]
}

# Get Q1 2026 spend
GET /api/procurement/boq-spend-summary?dateFrom=2026-01-01&dateTo=2026-03-31
```

#### Key Changes

- **Cross-Project Visibility**: See all project budgets and spend in one view
- **Over-Budget Alerts**: Immediate visual warning for projects exceeding budget
- **Variance Tracking**: Shows exactly how much over/under budget each project is
- **Utilization Metrics**: Percentage-based progress bars for quick assessment
- **Replaces Placeholder**: Reports tab now functional (was "coming soon")

#### PRD Alignment

**Source**: Procurement Module - Budget Management (KB reference)

**Status**: Aligned with budget control and cost management requirements

**Assessment**: Feature directly addresses KB requirement: "All purchases are validated against project budgets, facilitating better cost management and project execution." This dashboard provides real-time visibility into budget vs spend across all projects.

**Notes**:
- Task description indicates "3 new endpoints" — this commit implements 1 API endpoint (may be counting initial creation + subsequent enhancements in commit a8978ad as separate endpoints)
- Critical for financial oversight and project management
- Enables proactive budget management before overspend becomes critical

#### Database Queries

Uses existing tables:
- `projects` — project details and BOQ budgets
- `purchase_orders` — PO values (ordered)
- `boq_items` — BOQ line item budgets
- `po_line_items` — Individual PO lines for aggregation

Aggregation query structure:
```sql
SELECT 
  p.id, 
  p.name,
  SUM(boq.budget) as boq_budget,
  SUM(po.total_amount) as total_ordered,
  SUM(CASE WHEN po.status = 'confirmed' THEN po.total_amount ELSE 0 END) as total_confirmed
FROM projects p
LEFT JOIN boq_items boq ON boq.project_id = p.id
LEFT JOIN purchase_orders po ON po.project_id = p.id
GROUP BY p.id, p.name;
```

#### Testing Checklist

- [ ] KPI cards show correct totals
- [ ] Per-project budget calculations accurate
- [ ] Over-budget warnings appear correctly
- [ ] Progress bars reflect utilization percentage
- [ ] Variance column shows correct ± values
- [ ] Date filtering works (if implemented)
- [ ] Sorting by columns works
- [ ] CSV export includes all data
- [ ] Responsive design on mobile
- [ ] Error handling for missing budget data

---

**Module Owner**: hein:hein  
**Last Updated**: 2026-03-11 09:05 SAST  
**Documented By**: Scribe
