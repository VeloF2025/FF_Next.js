# Procurement Module

**End-to-End Procurement Workflow for Fibre Network Projects**

The Procurement module manages the complete purchase-to-payment lifecycle for fibre network material and services. It enforces a mandatory 10-step procurement workflow including Bill of Quantities (BOQ) budgeting, supplier management, quote evaluation, purchase order creation, goods receipt, and invoice reconciliation. Includes real-time budget vs. spend analytics, approval workflows, quote management, and field stock tracking.

---

## Purpose

The Procurement module solves five critical problems in fibre network project execution:

1. **Budget Control & Cost Visibility** — Projects overspend due to lack of real-time budget tracking. The module tracks BOQ budgets against committed and confirmed spend with over-budget warnings.

2. **Procurement Compliance** — Lack of standardized purchasing workflow creates audit risks. The module enforces a mandatory 10-step workflow with documented approval gates and competitive quote evaluation.

3. **Supplier Management** — Managing multiple suppliers and quotes manually is error-prone. The module centralizes supplier management, quote collection, and award decisions.

4. **Field Stock & Waste** — No visibility into material usage vs. planned quantities. The module tracks field stock allocations, usage, and discrepancies.

5. **Invoice Reconciliation** — Matching invoices to purchase orders is manual and time-consuming. The module provides automated 3-way matching (PO → Receipt → Invoice) with exceptions flagging.

---

## Key Features

- **10-Step Procurement Workflow** — Enforces sequence: Project → BOQ → Budget → PR → Sourcing → Quote & Award → PO → Approval → Goods Receipt → Invoice & Payment. Both RFQ and Direct PO paths require quote documentation.

- **Quote Evaluation & Award** — Compare supplier quotes side-by-side (price, lead time, rating). Award with justification notes. All POs must be based on an awarded quote.

- **Approval History with Status Tabs** — Full audit trail of all approval decisions. View pending, approved, and rejected approvals with who, when, and rejection reasons.

- **BOQ Spend vs. Budget Dashboard** — KPI cards showing total budget, committed spend, confirmed spend, and per-project utilization percentages. Red warnings for over-budget projects.

- **Expandable PO Details & CSV Export** — Drill into project rows to see all purchase orders and line items. Export filtered data to CSV for external analysis.

- **Supplier Portal** — Suppliers respond to RFQs directly, submit quotes, and view their orders.

- **Field Stock Tracking** — Track material allocations to field teams, usage adjustments, and reconciliation against BOQ.

- **Cost-Center Allocations** — Distribute PO costs across multiple cost centers with allocation tracking and transaction history.

- **Quote Scanner & Document Extraction** — Extract quote data from uploaded PDF/image documents using OCR and AI.

- **Open Orders & Fault Reporting** — Track pending POs and equipment faults during goods receipt.

---

## Module Structure

```
src/modules/procurement/
├── boq/
│   └── components/
│       ├── BOQTable.tsx                    # Bill of Quantities editor
│       └── ...
├── quotes/
│   └── components/
│       ├── QuoteComparison.tsx             # Side-by-side quote evaluation
│       └── ...
├── quote-scanner/
│   ├── components/
│   │   ├── QuoteUploader.tsx               # PDF/image upload
│   │   └── QuoteExtractor.tsx              # OCR extraction UI
│   ├── services/
│   │   └── extractionService.ts            # Document parsing
│   └── types/
│       └── scannerTypes.ts                 # Extraction result types
├── quote-evaluation/
│   └── components/
│       ├── QuoteEvaluation.tsx             # Quote award selection
│       └── ...
├── workflow/
│   ├── ProcurementWorkflowWizard.tsx       # 10-step wizard orchestrator
│   ├── WizardStepIndicator.tsx             # Step progress display
│   ├── steps/
│   │   ├── Step1CreateProject.tsx          # Project setup
│   │   ├── Step2BOQ.tsx                    # BOQ creation
│   │   ├── Step3Budget.tsx                 # Budget allocation
│   │   ├── Step4CreatePR.tsx               # Purchase requisition
│   │   ├── Step5Sourcing.tsx               # Supplier selection & RFQ
│   │   ├── Step6QuoteAward.tsx             # Quote comparison & award
│   │   ├── Step7CreatePO.tsx               # PO generation from quote
│   │   ├── Step8Approval.tsx               # Manager approvals
│   │   ├── Step9ReceiveGoods.tsx           # Goods receipt
│   │   └── Step10InvoicePayment.tsx        # Invoice matching & payment
│   ├── useWorkflowState.ts                 # Workflow state & persistence
│   └── ...
├── purchase-orders/
│   └── components/
│       ├── PurchaseOrderDetail.tsx         # PO view with line items
│       ├── POTransactionDetail.tsx         # Line-item transactions
│       └── ...
├── orders/
│   └── components/
│       └── ...
├── rfq/
│   └── components/
│       └── RFQForm.tsx                     # RFQ to suppliers
├── suppliers/
│   ├── components/
│   │   └── SupplierList.tsx                # Supplier directory
│   ├── hooks/
│   │   └── useSupplierData.ts
│   └── types/
│       └── supplierTypes.ts
├── supplier-portal/
│   └── components/
│       └── SupplierPortal.tsx              # External supplier interface
├── field-stock/
│   ├── components/
│   │   ├── StockAllocations.tsx            # Allocate materials to field teams
│   │   └── StockReconciliation.tsx         # Usage adjustments
│   ├── hooks/
│   │   └── useFieldStock.ts
│   ├── services/
│   │   └── fieldStockService.ts
│   └── types/
│       └── fieldStockTypes.ts
├── stock/
│   └── components/
│       └── ...
├── approvals/
│   ├── ApprovalCard.tsx                    # Approval display component
│   └── ...
├── reports/
│   ├── components/
│   │   ├── BOQSpendSummary.tsx             # Spend vs budget dashboard
│   │   ├── BOQSpendKPICards.tsx            # Summary KPI cards
│   │   └── ...
│   └── utils/
│       └── ...
├── documents/
│   ├── components/
│   │   └── ...
│   └── hooks/
│       └── ...
├── reporting/
│   ├── components/
│   │   └── ...
│   └── hooks/
│       └── ...
├── audit/
│   ├── components/
│   │   └── AuditLog.tsx                    # Procurement audit trail
│   └── hooks/
│       └── useAuditLog.ts
├── context/
│   └── ProcurementContext.tsx              # Shared procurement state
├── components/
│   ├── ProcurementDashboard.tsx            # Main procurement hub
│   ├── ProcurementOverview.tsx             # Dashboard summary
│   ├── ProcurementPage.tsx                 # Top-level container
│   ├── tabs/
│   │   └── ...
│   ├── layout/
│   │   └── ...
│   └── ...
├── hooks/
│   ├── useProcurement.ts
│   ├── useProcurementWorkflow.ts
│   └── ...
├── types/
│   ├── procurementTypes.ts                 # Core types
│   └── ...
└── utils/
    ├── procurementHelpers.ts               # Utility functions
    └── ...

pages/api/procurement/
├── boq-spend-summary.ts                    # GET: Budget vs spend summary
├── boq-lifecycle.ts                        # GET: BOQ workflow state
├── approvals/
│   └── all.ts                              # GET: All approval history (pending/approved/rejected)
├── quotes/
│   ├── extract-from-document.ts            # POST: OCR extraction from PDF/image
│   ├── create-from-extraction.ts           # POST: Create quote from extracted data
│   └── award.ts                            # POST: Award selected quote
├── rfq-suppliers.ts                        # GET: RFQ suppliers & quote status
├── purchase-orders/
│   ├── index.ts                            # POST: Create PO from awarded quote
│   └── [id].ts                             # GET/PATCH: PO details
├── cost-centers/
│   ├── index.ts                            # GET/POST: Cost center management
│   ├── [id].ts                             # GET/PATCH/DELETE: Cost center detail
│   ├── [id]/allocations.ts                 # GET: Cost center allocations
│   └── [id]/transactions.ts                # GET: Cost center transactions
├── open-orders-export.ts                   # GET: Export pending POs to CSV
├── aggregate-metrics.ts                    # GET: Procurement KPIs
├── stock-items-search.ts                   # GET: Search field stock items
├── adjustments/
│   └── index.ts                            # POST: Stock adjustment entries
├── fault-reports/
│   ├── index.ts                            # GET/POST: Goods receipt fault reports
│   └── analytics.ts                        # GET: Fault analytics
├── tab-badges.ts                           # GET: Badge counts (pending approvals, etc.)
└── ...
```

### Directory Purposes

- **boq/** — Bill of Quantities creation, editing, and management
- **quotes/** — Quote storage and retrieval (supplier responses)
- **quote-scanner/** — OCR/AI extraction from PDF quotes and images
- **quote-evaluation/** — Quote comparison and supplier award workflow
- **workflow/** — The 10-step wizard orchestrating the entire procurement process
- **purchase-orders/** — Purchase order lifecycle and detail views
- **rfq/** — Request for Quote distribution and tracking
- **suppliers/** — Supplier directory and relationship management
- **supplier-portal/** — External-facing portal for suppliers to respond to RFQs and view orders
- **field-stock/** — Material allocation and usage tracking for field teams
- **approvals/** — Budget and PO approval workflows with audit trail
- **reports/** — Procurement analytics and spend dashboards
- **audit/** — Complete audit log of all procurement decisions
- **pages/api/procurement/** — Next.js API endpoints for all procurement operations

---

## Key Concepts

### 10-Step Procurement Workflow

The module enforces a mandatory sequence to ensure compliance and visibility:

| Step | Name | Purpose | Key Output |
|------|------|---------|------------|
| 1 | Create Project | Define project scope and dates | Project ID |
| 2 | BOQ | List materials with quantities and estimated costs | BOQ items with costs |
| 3 | Budget | Allocate total budget and cost centers | Budget approval |
| 4 | Create PR | Request material procurement | Purchase Requisition ID |
| 5 | Sourcing | Identify suppliers and issue RFQs | RFQ sent to suppliers |
| 6 | Quote & Award | Evaluate quotes and select supplier | Awarded Quote ID |
| 7 | Create PO | Generate PO from awarded quote | Purchase Order with line items |
| 8 | Approval | Manager reviews and approves | Approval authority recorded |
| 9 | Receive Goods | Confirm receipt against PO lines | GRN (Goods Receipt Note) |
| 10 | Invoice & Payment | Match invoice to PO/GRN, process payment | Payment status |

Both RFQ and Direct PO paths require Step 6 (Quote & Award) — cannot create PO without documented quote.

### Approval Tiers

- **Budget Approval** — Finance approval before procurement can proceed (Step 3)
- **PO Approval** — Manager approval before issuing PO (Step 8)
- **Invoice Approval** — Accounting approval before payment (Step 10)

Each approval records: who (user), when (timestamp), status (pending/approved/rejected), and rejection reason.

### Budget Tracking

**Budget Utilization** = (Total Ordered / BOQ Budget) × 100

- **Green** — < 90% utilized (safe)
- **Yellow** — 90-100% utilized (caution)
- **Red** — > 100% (over budget, requires variance approval)

States tracked:
- **Budget** — Original BOQ allocation
- **Ordered** — Total PO value created (committed spend)
- **Confirmed** — Goods receipt confirmed (actual spend)

### Quote Evaluation Criteria

- **Unit Price** — Lowest cost (but not sole criterion)
- **Total Amount** — Price × quantity across all items
- **Lead Time** — Delivery days from order
- **Supplier Rating** — Historical quality score (1-5 stars)
- **Justification** — Why this quote was selected

### Field Stock Allocation

Materials are allocated from warehouse to field teams:

```
BOQ Item (Qty: 100) 
  ├─ Team A: 40 units allocated
  ├─ Team B: 35 units allocated
  └─ Reserve: 25 units unallocated

Usage tracked per field team with discrepancies flagged.
```

---

## Important Files

### API Entry Points

- **boq-spend-summary.ts** — GET /api/procurement/boq-spend-summary
  - Returns: total budget, ordered, confirmed, per-project utilization
  - Query params: `dateFrom`, `dateTo`, `projectId`, `expand=transactions` (for drill-down)
  - Flags `isOverBudget: true` for red-warning projects

- **approvals/all.ts** — GET /api/procurement/approvals/all
  - Returns: full approval history with metadata
  - Query params: `status` (pending|approved|rejected), `userId`, `limit`
  - Includes: who approved, when, rejection reason

- **quotes/award.ts** — POST /api/procurement/quotes/award
  - Body: `{ quoteId, prId, justification }`
  - Creates award decision and enables Step 7 PO creation

- **purchase-orders/index.ts** — POST /api/procurement/purchase-orders
  - Body: `{ prId, quoteId, supplierId, lineItems, paymentTerms }`
  - Generates PO from awarded quote

- **quotes/extract-from-document.ts** — POST /api/procurement/quotes/extract-from-document
  - Body: FormData with PDF/image file
  - Returns: extracted quote fields (supplier, items, prices, lead time)

### Key Components

- **ProcurementWorkflowWizard.tsx** — Main 10-step wizard container
- **BOQSpendSummary.tsx** — Budget vs. spend dashboard with drill-down
- **QuoteComparison.tsx** — Side-by-side quote evaluation table
- **PurchaseOrderDetail.tsx** — PO view with line items and status

### Key Services

- **fieldStockService.ts** — Stock allocation and usage tracking
- **extractionService.ts** — Document parsing for quote data
- Workflow state management in `workflow/useWorkflowState.ts`

### Type Definitions

- **ProcurementTypes** — PR, PO, Quote, Supplier, BOQ item types
- **ApprovalTypes** — Approval request, decision, audit record
- **FieldStockTypes** — Allocation, usage, reconciliation records

---

## Getting Started

### Understanding the Procurement Workflow

1. **Read** `CHANGELOG.md` to understand recent 10-step workflow redesign and quote evaluation
2. **Explore** `workflow/ProcurementWorkflowWizard.tsx` to see step orchestration
3. **Review** `workflow/steps/Step6QuoteAward.tsx` to understand quote comparison UI
4. **Check** `workflow/steps/Step7CreatePO.tsx` to see PO creation from quote

### Understanding Budget Tracking

1. **Navigate to** `pages/api/procurement/boq-spend-summary.ts` to see budget aggregation logic
2. **Review** `src/modules/procurement/reports/BOQSpendSummary.tsx` for dashboard UI
3. **Examine** the SQL query structure for project-level budget calculations
4. **Check** color-coding logic: green (< 90%), yellow (90-100%), red (> 100%)

### Understanding Approval Workflow

1. **Review** `pages/api/procurement/approvals/all.ts` for approval history endpoint
2. **Explore** `src/modules/procurement/approvals/ApprovalCard.tsx` for approval display
3. **Check** `pages/procurement/index.tsx` (approvals tab) for UI integration
4. **Examine** database schema for approval status, timestamps, and rejection reasons

### Adding a New Procurement Step

1. Create step component: `workflow/steps/Step[N][Name].tsx`
2. Update `ProcurementWorkflowWizard.tsx` with step routing
3. Add step to `WizardStepIndicator.tsx` progress display
4. Update `useWorkflowState.ts` with step completion criteria
5. Create API endpoint in `pages/api/procurement/` if data persistence is needed
6. Update CHANGELOG.md with feature description

### Extending Field Stock Tracking

1. Check `field-stock/types/fieldStockTypes.ts` for data structures
2. Review `field-stock/services/fieldStockService.ts` for allocation logic
3. Add allocation component to `field-stock/components/`
4. Create API endpoint in `pages/api/procurement/` if needed

### Debugging Budget Overages

1. Run query: `SELECT project_id, SUM(total_amount) as ordered FROM purchase_orders GROUP BY project_id HAVING SUM(total_amount) > boq_budget`
2. Check which POs caused overage
3. Investigate variance approval records in procurement_approvals table
4. Review CHANGELOG for budget policy changes

---

## See Also

- **CHANGELOG.md** — Recent features and detailed commit history
- **boq-spend-dashboard.md** — Detailed dashboard documentation (if present)
- **pages/api/procurement/** — All API endpoints with examples
- **src/modules/procurement/types/procurementTypes.ts** — Complete type definitions
- **Architecture** — See main FibreFlow architecture docs for module integration
- **Database Schema** — Contact DBA for tables: `purchase_requisitions`, `purchase_orders`, `quotes`, `boq_items`, `suppliers`, `procurement_approvals`

---

**Last Updated**: 2026-03-11  
**Module Owner**: Hein  
**Maintainer**: Claude Sonnet 4.5
