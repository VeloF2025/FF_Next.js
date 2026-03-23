# Procurement Module

**Last Updated:** 2026-03-11  
**Status:** Production (v3.0 — 10-step workflow)

## Overview

The Procurement module manages the complete procurement lifecycle — from requisition through purchase order creation, goods receipt, and payment. It supports two procurement strategies: **RFQ (Request for Quote)** for competitive sourcing and **Direct PO** for pre-selected suppliers. The module integrates with the Activate module for requisitions and Accounting for invoice/payment tracking.

## Module Purpose

- **Requisition Management** — Create, track, and approve procurement requisitions
- **Sourcing Workflows** — RFQ for competitive bidding or Direct PO for single-supplier procurement
- **Quote Evaluation** — Centralized quote comparison and award decision (Step 6)
- **Purchase Order Generation** — Create POs from awarded quotes with delivery details (Step 7)
- **Goods Receipt** — Track incoming goods and validate against PO
- **Payment Processing** — Approve and process supplier payments
- **Compliance Tracking** — Audit trail for all procurement decisions and approvals

## Key Features

### 1. Procurement Workflow (10-Step)
A structured, approval-gated workflow ensures procurement governance:

| Step | Name | Responsibility |
|------|------|-----------------|
| 1 | Requirements | Requestor defines procurement needs |
| 2 | Strategy | Select RFQ (competitive) or Direct PO (single supplier) |
| 3 | Submit | Review and submit requirements |
| 4 | Approval | Internal approval committee gate |
| 5 | Sourcing | Send RFQ or select supplier |
| **6** | **Quote & Award** | Evaluate quotes, select winning supplier, lock amount |
| **7** | **Create PO** | Generate PO with delivery address |
| 8 | Receive Goods | Confirm goods arrival and quality |
| 9 | Payment | Process supplier payment |
| 10 | Complete | Archive and close requisition |

### 2. Requisition Management
- Create requisition with item details, quantities, budget estimate
- Track requisition status through approval workflow
- Link requisitions to projects and cost centers
- Bulk requisition operations for multi-item purchases

### 3. RFQ (Request for Quote) Workflow
- **Sourcing (Step 5):** Select multiple suppliers to invite to RFQ
- **Quote & Award (Step 6):** Collect quotes from suppliers, compare amounts/delivery, award to winner
- **Endpoint:** `GET /api/procurement/rfq-suppliers?rfqId={id}` — returns invited suppliers
- Automatic RFQ creation via `POST /api/procurement/requisitions/{id}/create-rfq`

### 4. Direct PO Workflow
- **Sourcing (Step 5):** Select pre-approved supplier directly
- **Quote & Award (Step 6):** Enter supplier's quote amount
- **Create PO (Step 7):** Generate PO immediately
- Faster path for known suppliers (no competitive bidding)

### 5. Quote Evaluation (NEW — Step 6)
- Compare supplier quotes side-by-side (RFQ path)
- Enter delivery timeline and special notes
- Select winning supplier and locked quote amount
- Enforces explicit award decision before PO creation

### 6. Purchase Order Generation (NEW — Step 7)
- Create PO from awarded quote in one action
- Require delivery address for PO
- Auto-generate PO number with timestamp
- Link PO to original requisition and selected supplier

### 7. Goods Receipt & Quality Control
- Track incoming goods against PO line items
- Match GRN (Goods Receipt Note) to PO
- Record quality checks and discrepancies
- Trigger payment only after goods receipt confirmed

### 8. Payment Processing
- Create payment request for approved invoices
- Approval workflow for payment authorization
- Track payment status and bank transfers
- Integration with Accounting module for GL posting

### 9. Supplier Management
- Maintain approved supplier list
- Track supplier ratings and performance
- Link suppliers to requisition history

## API Endpoints

### Requisitions

- **POST** `/api/procurement/requisitions` — Create new requisition
- **GET** `/api/procurement/requisitions` — List requisitions (paginated, filterable by status/project)
- **GET** `/api/procurement/requisitions/{id}` — Retrieve requisition details
- **PATCH** `/api/procurement/requisitions/{id}` — Update requisition status/metadata
- **DELETE** `/api/procurement/requisitions/{id}` — Cancel requisition

### RFQ Operations

- **POST** `/api/procurement/requisitions/{id}/create-rfq` — Submit RFQ with supplier list
- **GET** `/api/procurement/rfq-suppliers?rfqId={id}` — List suppliers invited to RFQ
- **GET** `/api/procurement/rfq/{id}` — Retrieve RFQ details
- **PATCH** `/api/procurement/rfq/{id}` — Update RFQ status

### Purchase Orders

- **POST** `/api/procurement/requisitions/{id}/convert-to-po` — Create PO from awarded quote
  - **Payload:** `{ supplierId, deliveryAddress, quotedAmount }`
- **GET** `/api/procurement/purchase-orders` — List purchase orders
- **GET** `/api/procurement/purchase-orders/{id}` — Retrieve PO details
- **PATCH** `/api/procurement/purchase-orders/{id}` — Update PO (delivery address, line items)

### Goods Receipt

- **POST** `/api/procurement/purchase-orders/{id}/receive-goods` — Create GRN
  - **Payload:** `{ items: [{ line_id, quantity_received, quality_notes }], grn_number }`
- **GET** `/api/procurement/grn/{id}` — Retrieve GRN details
- **PATCH** `/api/procurement/grn/{id}` — Update GRN status (accepted/discrepancy)

### Payments

- **POST** `/api/procurement/invoices` — Create invoice from GRN
- **GET** `/api/procurement/invoices` — List invoices (filterable by status)
- **POST** `/api/procurement/invoices/{id}/approve` — Approve for payment
- **POST** `/api/procurement/invoices/{id}/pay` — Process payment (GL posting)

### Analytics

- **GET** `/api/procurement/analytics/vendor-performance` — Supplier performance metrics
- **GET** `/api/procurement/analytics/budget-vs-actual` — Budget tracking by project/category
- **GET** `/api/procurement/analytics/cycle-time` — Average procurement cycle duration

## Frontend Components

### Workflow Wizard
- `ProcurementWorkflowWizard.tsx` — Main 10-step orchestrator with DB thread tracking
- `WizardStepIndicator.tsx` — 10-step visual progress bar with responsive labels
- `useWorkflowState.ts` — State management for workflow progression

### Step Components
- `Step1Requirements.tsx` — Item details, quantity, budget entry
- `Step2Strategy.tsx` — RFQ vs Direct PO selection
- `Step3Submit.tsx` — Requirements review and submission
- `Step4Approval.tsx` — Approval committee gate
- `Step5Order.tsx` (renamed `Step5Sourcing.tsx`) — Supplier selection (RFQ multi-select or Direct single-select)
- **`Step6QuoteAward.tsx` (NEW)** — Quote evaluation and award decision
- **`Step7CreatePO.tsx` (NEW)** — PO creation from awarded quote
- `Step8Receive.tsx` — Goods receipt tracking
- `Step9Payment.tsx` — Payment approval and processing
- `Step10Complete.tsx` — Finalization and archival

### Supporting Components
- `ProcurementDocumentPanel.tsx` — Document upload/download (RFQ attachments, PO PDFs)
- `SupplierSelector.tsx` — Reusable supplier selection control (RFQ multi-select, Direct single-select)
- `BudgetEstimator.tsx` — Line item and total budget calculator
- `GRNForm.tsx` — Goods receipt entry form

## Database Schema

### Core Tables
- **requisitions** — Procurement requisitions with status (draft, submitted, approved, sourcing, quote, po, received, payment, complete)
- **requisition_items** — Line items within a requisition (item_id, quantity, unit_price_est, category)
- **rfq** — RFQ records (requisition_id, supplier_count, submission_deadline, status)
- **rfq_suppliers** — RFQ supplier invitations (rfq_id, supplier_id, invited_date, quote_received_date, quote_amount)
- **purchase_orders** — POs created from requisitions (requisition_id, supplier_id, po_number, total_amount, delivery_address, status)
- **po_line_items** — PO line items (po_id, item_id, quantity_ordered, quantity_received, unit_price)
- **goods_receipts** — GRN records (po_id, grn_number, received_date, received_qty, quality_notes, status)
- **invoices** — Supplier invoices (po_id, supplier_id, invoice_number, amount, due_date, status)
- **invoice_payments** — Payment records (invoice_id, amount_paid, payment_date, bank_ref)
- **suppliers** — Supplier master (name, contact, address, rating, status, approved_date)

### Workflow Tracking
- **noc_workflow_thread** — Shared workflow state (requisitionId, threadId, currentStep, completedSteps, awardedQuoteAmount, poTotal, status)

## Integration Points

1. **Activate Module** — Source of requisitions; links to activation workflows
2. **Accounting Module** — GL posting for PO line items and invoice payments
3. **Auth Module** — RBAC for approval workflows (Procurement Manager, Approver roles)
4. **File Service** — RFQ document attachments, PO PDFs
5. **Notification System** — Approval request alerts, PO confirmation emails
6. **Analytics** — Budget tracking, vendor performance reporting

## Security & Governance

- **RBAC** — Procurement Manager (create/submit), Approver (approval gate), Finance (payment approval)
- **Approval Gates** — Step 4 requires documented approval from authorization committee
- **Audit Trail** — All requisition changes, approvals, PO creation logged with timestamps and user
- **Budget Control** — Requisition budget checked against project allocation; over-budget requires special approval
- **Segregation of Duties** — Requisition creator cannot approve; approval and payment by different roles

## Testing & Validation

- Unit tests cover requisition creation, RFQ supplier selection, quote comparison, PO generation
- Integration tests validate end-to-end workflows (RFQ path and Direct PO path)
- E2E tests cover approval gates and goods receipt matching
- Performance tests validate large RFQ lists (50+ suppliers) load in <2 seconds

## Deployment Checklist

- [ ] All 10 step components deployed and rendering correctly
- [ ] RFQ supplier list endpoint (`rfq-suppliers`) functional and returns expected supplier data
- [ ] PO conversion endpoint (`convert-to-po`) creates POs with correct poNumber generation
- [ ] Workflow state management tracks all new fields: `awardedQuoteAmount`, `selectedSupplierId`, `selectedSupplierName`, `poId`, `poNumber`
- [ ] Step 6 (Quote & Award) loads and displays suppliers correctly from RFQ
- [ ] Step 7 (Create PO) displays confirmation with PO number and link to PO detail
- [ ] GRN and payment workflows functional downstream of PO creation
- [ ] All API endpoints return expected status codes (200, 201, 400, 404, 500)
- [ ] Approval notifications sent at Step 4 gate
- [ ] PO confirmation emails sent to suppliers

## Performance Notes

- RFQ supplier list fetches in parallel with Step 6 render; may show loading state
- PO creation is synchronous; submission waits for response before showing success
- Goods receipt matching (GRN → PO) is indexed on po_id for fast lookups
- Invoice aggregation for payment batch processing is daily (off-peak hours)

## Support & Escalation

For procurement issues:
1. Check requisition status in workflow dashboard
2. Verify approval chain completed at Step 4
3. Check RFQ supplier list loaded in Step 6
4. Verify PO generation succeeded in Step 7
5. Escalate to Finance team for payment processing issues

---

**Module Owner:** Elon (CTO)  
**Documentation:** Scribe  
**Last Verified:** 2026-03-11  
**Version:** 3.0 (10-Step Workflow)
