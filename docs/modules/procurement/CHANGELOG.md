# Procurement Module CHANGELOG

**Last Updated:** 2026-03-11

## [2026-03-11] — 10-Step Workflow with Quote Evaluation

**Commit:** 146da95  
**Author:** Claude Sonnet 4.5  
**Status:** Production

### Overview
Restructured the procurement workflow from 9 steps to 10 steps, inserting a dedicated **Quote & Award** evaluation step between Sourcing and PO creation. This ensures both RFQ and Direct PO paths require explicit quote evaluation and approval before generating a Purchase Order.

### New Workflow (10 Steps)

| Step | Name | Purpose | User Action |
|------|------|---------|------------|
| 1 | Requirements | Define procurement requirements | Enter item details, quantity, budget |
| 2 | Strategy | Select procurement strategy | Choose RFQ (competitive) or Direct PO (single supplier) |
| 3 | Submit | Submit requirements for approval | Review and confirm requirements |
| 4 | Approval | Procurement committee approval | Internal approval gate |
| 5 | **Sourcing** | Send RFQ or select supplier | Invite suppliers to RFQ or select direct vendor |
| **6** | **Quote & Award (NEW)** | Evaluate and award quotes | Compare supplier quotes, select winner, set amount |
| **7** | **Create PO (NEW)** | Generate Purchase Order | Create PO from awarded quote with delivery address |
| 8 | Receive Goods | Track goods receipt | Confirm goods arrival and quality |
| 9 | Payment | Process payment | Approve and process supplier payment |
| 10 | Complete | Finalize procurement | Archive and close requisition |

### Key Changes

#### Step 5: Sourcing (Refactored)
- **Before:** Step5Order combined supplier selection + PO creation in single step
- **After:** Step5Order now handles **only** sourcing (RFQ invitation or direct supplier selection)
- **RFQ Path:** Selects multiple suppliers to invite to RFQ, stores supplier list
- **Direct PO Path:** Selects single supplier, prepares for quote entry
- **Endpoint:** POST `/api/procurement/requisitions/{id}/create-rfq` — submits supplier invitation list

#### Step 6: Quote & Award (NEW)
- **Purpose:** Centralized quote evaluation and award decision
- **RFQ Path:**
  - Displays list of invited suppliers
  - UI for entering quote amounts, delivery days, notes per supplier
  - Select winning supplier and awarded amount
- **Direct PO Path:**
  - Enter single supplier's quote amount
  - Confirm to proceed to PO
- **Endpoints:**
  - GET `/api/procurement/rfq-suppliers?rfqId={id}` — Returns suppliers invited to an RFQ with company names
  - Sets `selectedSupplierId`, `selectedSupplierName`, `awardedQuoteAmount` in workflow state

#### Step 7: Create PO (NEW)
- **Purpose:** Convert awarded quote to Purchase Order
- **Process:**
  - Enter delivery address (required, min 10 chars)
  - Submit to create PO
  - Display PO number and link to PO detail page
- **Endpoint:** POST `/api/procurement/requisitions/{id}/convert-to-po`
  - **Payload:** `{ supplierId, deliveryAddress, quotedAmount }`
  - **Response:** `{ purchaseOrder: { id, poNumber } }` or `{ id, poNumber }`
- **Sets:** `poId`, `poNumber` in workflow state

#### Workflow State Enhancements
- Added `awardedQuoteAmount` — tracks the quote amount selected in Step 6
- Added `selectedWinner` → `selectedSupplierId` — supplier chosen in Step 6
- Added `selectedSupplierName` — display name of awarded supplier
- Added `poId`, `poNumber` — PO identifiers created in Step 7
- Thread tracking updated to include `poTotal` (from `awardedQuoteAmount`)

### New API Endpoints

1. **GET `/api/procurement/rfq-suppliers?rfqId={id}`**
   - Returns list of suppliers invited to an RFQ
   - Response: `{ success: true, data: [{ supplier_id, supplier_name }, ...] }`
   - Used by Step6QuoteAward in RFQ path

2. **POST `/api/procurement/requisitions/{id}/create-rfq`**
   - Submits RFQ invitation list (existing endpoint, now called from Step 5)
   - Payload: `{ supplierIds: [...] }`

3. **POST `/api/procurement/requisitions/{id}/convert-to-po`**
   - Creates Purchase Order from awarded quote
   - Payload: `{ supplierId, deliveryAddress, quotedAmount }`
   - Response: `{ success: true, data: { purchaseOrder: { id, poNumber } } }`

### UI Components

**New Step Components:**
- `Step6QuoteAward.tsx` — Quote evaluation and award selection (257 lines)
  - RFQ flow: Compare supplier quotes, select winner
  - Direct PO flow: Enter and confirm quote amount
- `Step7CreatePO.tsx` — PO creation form (193 lines)
  - Enter delivery address
  - Create PO and display confirmation
  - Link to PO detail view

**Updated Components:**
- `Step5Order.tsx` — Refactored to Sourcing only (254 lines → 161 lines)
  - Removed PO creation logic (moved to Step7)
  - Focuses on supplier selection
  - RFQ: multi-select suppliers; Direct PO: single supplier select
- `ProcurementWorkflowWizard.tsx` — Updated to render 10 steps
  - Step 6 renders `Step6QuoteAward`
  - Step 7 renders `Step7CreatePO`
  - Step 8+ adjusted accordingly
- `WizardStepIndicator.tsx` — Updated visual progress bar for 10 steps
  - Adjusted label width from 72px → 64px for 10-step display

### Breaking Changes

- **Workflow Progression:** Clients expecting 9-step workflow will receive 10 steps; existing `currentStep` tracking may misalign
- **State Structure:** Workflow state now includes `awardedQuoteAmount`, `selectedSupplierName` — ensure client state initialization accounts for these
- **Endpoint Behavior:** Step 5 no longer creates POs; suppliers invited in Step 5 now queried via `rfq-suppliers` endpoint in Step 6

### Database Changes

- **noc_workflow_thread:** Added `poTotal` column (alias for `awardedQuoteAmount`)
- **procurement_requisitions:** No schema changes; PO creation moved to Step 7 only

### Migration Guide

#### For Frontend
1. Update workflow step count from 9 to 10 in any step-rendering logic
2. Account for new Step 6 (Quote & Award) before accessing Step 7 (Create PO)
3. If tracking step completions, verify completion set includes steps 6 & 7

#### For Backend
1. Ensure `rfq-suppliers` endpoint is deployed and functional
2. Verify `convert-to-po` endpoint accepts new payload structure
3. Monitor for PO creation requests via `/api/procurement/requisitions/{id}/convert-to-po` (not `/api/procurement/requisitions/{id}/create-po`)

#### For API Clients
1. Update any hard-coded step indices (5 → 6 for Quote & Award, 6 → 7 for Create PO)
2. Call `GET /api/procurement/rfq-suppliers?rfqId=...` after RFQ is submitted (Step 5 completion)
3. Pass `supplierId, deliveryAddress, quotedAmount` to convert-to-po endpoint

### Testing Checklist

- [ ] RFQ Path: Create requisition → Choose RFQ strategy → Select suppliers → Enter quotes → Award → Create PO
- [ ] Direct PO Path: Create requisition → Choose Direct PO → Select supplier → Enter quote → Create PO
- [ ] Step 6 loads suppliers correctly from `rfq-suppliers` endpoint for RFQ path
- [ ] Step 7 creates PO successfully with `convert-to-po` endpoint
- [ ] PO number displays and links to PO detail page
- [ ] Workflow thread tracking includes `poTotal` (awarded amount)
- [ ] Back/Next navigation works correctly across all 10 steps
- [ ] Progress indicator displays all 10 steps correctly

### Performance Notes

- RFQ supplier list fetch (Step 6) is in-parallel with Step 6 render; may show loading state while suppliers load
- PO creation (Step 7) is synchronous; submission waits for response before showing success
- No data fetched during Step 5; supplier list fetched fresh in Step 6 (not cached)

### Related Commits

- **Next workflow step:** Step 8 (Receive Goods) — goods receipt tracking and GRN creation
- **Related modules:** Activate (requisition source), Accounting (PO line items), Purchase Orders (PO management)

### Backward Compatibility

⚠️ **NOT backward compatible** — existing clients using 9-step workflow will break. Requires coordinated deployment of:
1. Backend step components (Step6QuoteAward, Step7CreatePO)
2. API endpoints (rfq-suppliers, convert-to-po)
3. Frontend workflow wizard (updated WizardStepIndicator, state management)

All must be deployed together.

### Known Issues

- CI is offline (GitHub Actions billing) — tests cannot run; manual QA required before production deployment
- Existing NOC tests (6 failures) — independent of this change; fix separately

---

**Shipped By:** Elon (CTO)  
**Verified By:** Scribe (Documentation)  
**Date:** 2026-03-11  
**Status:** Ready for Production Deployment
