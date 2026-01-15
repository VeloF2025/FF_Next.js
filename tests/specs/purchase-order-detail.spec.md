# Test Specification: Purchase Order Detail Page

## Overview
Detail view page for individual purchase orders showing full PO information, line items, receipt status, and workflow actions.

## Route
`/procurement/purchase-orders/[id]`

## Data Model

### PurchaseOrderDetail
```typescript
interface PurchaseOrderDetail {
  id: string;
  poNumber: string;
  status: POStatus;
  supplierId: number;
  supplierName: string;
  supplierEmail?: string;
  supplierPhone?: string;
  projectId: string | null;
  projectName: string | null;
  deliveryAddress: string;
  expectedDeliveryDate: string | null;
  paymentTerms: string;
  currency: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  items: POLineItem[];
  history: POHistoryEvent[];
  receipts: POReceipt[];
}

type POStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'sent'
  | 'acknowledged'
  | 'partial_receipt'
  | 'completed'
  | 'cancelled';

interface POLineItem {
  id: string;
  lineNumber: number;
  description: string;
  itemCode: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  quantityPending: number;
  unitOfMeasure: string;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
}

interface POHistoryEvent {
  id: string;
  action: string;
  notes: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

interface POReceipt {
  id: string;
  grnNumber: string;
  receivedDate: string;
  receivedBy: string;
  totalItems: number;
}
```

## UI Components

### 1. Header Section
- Back button to PO list
- PO number as title
- Status badge with icon
- Action buttons based on status

### 2. Status Badge Configurations
| Status | Color | Icon |
|--------|-------|------|
| draft | gray | Clock |
| pending_approval | yellow | Clock |
| approved | green | CheckCircle |
| sent | blue | Send |
| acknowledged | indigo | Package |
| partial_receipt | orange | Truck |
| completed | green | CheckCircle |
| cancelled | red | XCircle |

### 3. Action Buttons by Status
| Status | Available Actions |
|--------|-------------------|
| draft | Edit, Submit for Approval, Delete |
| pending_approval | Approve, Reject (if approver) |
| approved | Send to Supplier, Cancel |
| sent | Mark Acknowledged, Cancel |
| acknowledged | Receive Goods (GRN), Cancel |
| partial_receipt | Receive More Goods, Complete, Cancel |
| completed | (none - read only) |
| cancelled | (none - read only) |

### 4. Tabs
- **Details**: PO information, supplier, delivery
- **Items**: Line items table with receipt status
- **Receipts**: GRN history and received quantities
- **History**: Audit trail of all actions

### 5. Details Tab Content
- Supplier Information card
- Delivery Information card
- Payment Terms card
- Summary (Subtotal, VAT, Total)

### 6. Items Tab Content
Table columns:
- Line #
- Description
- Code
- Ordered Qty
- Received Qty
- Pending Qty
- UOM
- Unit Price
- Line Total
- Status indicator (full/partial/pending)

### 7. Receipts Tab Content
List of GRN entries with:
- GRN Number (link to GRN detail)
- Received Date
- Received By
- Items Count

### 8. History Tab Content
Timeline showing:
- Action performed
- User who performed
- Timestamp
- Notes/comments

## Test Cases

### TC-POD-001: Page Loading
**Given** a valid PO ID in the URL
**When** the page loads
**Then** display PO details with correct status badge and available actions

### TC-POD-002: Invalid PO ID
**Given** an invalid or non-existent PO ID
**When** the page loads
**Then** display "Purchase order not found" error with link back to list

### TC-POD-003: Status Badge Display
**Given** a PO with any status
**When** viewing the detail page
**Then** display the correct color and icon for that status

### TC-POD-004: Draft Actions
**Given** a PO with status "draft"
**When** viewing the detail page
**Then** show Edit, Submit for Approval, and Delete buttons

### TC-POD-005: Pending Approval Actions (Approver)
**Given** a PO with status "pending_approval" and user is an approver
**When** viewing the detail page
**Then** show Approve and Reject buttons

### TC-POD-006: Pending Approval Actions (Non-Approver)
**Given** a PO with status "pending_approval" and user is not an approver
**When** viewing the detail page
**Then** show no action buttons (read-only view)

### TC-POD-007: Approved Actions
**Given** a PO with status "approved"
**When** viewing the detail page
**Then** show Send to Supplier and Cancel buttons

### TC-POD-008: Sent Actions
**Given** a PO with status "sent"
**When** viewing the detail page
**Then** show Mark Acknowledged and Cancel buttons

### TC-POD-009: Acknowledged Actions
**Given** a PO with status "acknowledged"
**When** viewing the detail page
**Then** show Receive Goods and Cancel buttons

### TC-POD-010: Partial Receipt Actions
**Given** a PO with status "partial_receipt"
**When** viewing the detail page
**Then** show Receive More, Complete, and Cancel buttons

### TC-POD-011: Completed/Cancelled Read-Only
**Given** a PO with status "completed" or "cancelled"
**When** viewing the detail page
**Then** show no action buttons (read-only)

### TC-POD-012: Items Tab Display
**Given** a PO with line items
**When** clicking the Items tab
**Then** display table with all items and receipt status

### TC-POD-013: Item Receipt Status
**Given** a line item with partial receipt
**When** viewing the Items tab
**Then** show ordered, received, and pending quantities with visual indicator

### TC-POD-014: Receipts Tab
**Given** a PO with GRN records
**When** clicking the Receipts tab
**Then** display list of all GRN entries with links

### TC-POD-015: History Tab
**Given** a PO with history events
**When** clicking the History tab
**Then** display timeline of all actions in chronological order

### TC-POD-016: Currency Formatting
**Given** any monetary values
**When** displaying on the page
**Then** format as ZAR currency (R X,XXX.XX)

### TC-POD-017: VAT Calculation Display
**Given** a PO with subtotal and tax
**When** viewing the Summary section
**Then** show Subtotal, VAT (with rate %), and Total correctly

### TC-POD-018: Submit for Approval Action
**Given** a draft PO
**When** clicking "Submit for Approval"
**Then** change status to "pending_approval" and add history event

### TC-POD-019: Approve Action
**Given** a pending_approval PO and user is approver
**When** clicking "Approve"
**Then** change status to "approved" and add history event

### TC-POD-020: Reject Action
**Given** a pending_approval PO and user is approver
**When** clicking "Reject" and providing reason
**Then** change status to "draft" and add history event with reason

### TC-POD-021: Send to Supplier Action
**Given** an approved PO
**When** clicking "Send to Supplier"
**Then** change status to "sent" and add history event

### TC-POD-022: Mark Acknowledged Action
**Given** a sent PO
**When** clicking "Mark Acknowledged"
**Then** change status to "acknowledged" and add history event

### TC-POD-023: Cancel Action
**Given** a PO in cancellable status
**When** clicking "Cancel" and confirming
**Then** change status to "cancelled" and add history event

### TC-POD-024: Delete Draft Action
**Given** a draft PO
**When** clicking "Delete" and confirming
**Then** delete the PO and redirect to list

### TC-POD-025: Edit Draft Navigation
**Given** a draft PO
**When** clicking "Edit"
**Then** navigate to edit page with PO data

## API Endpoints

### GET /api/procurement/purchase-orders/[id]
Returns full PO detail with items, history, and receipts.

Response:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "poNumber": "PO-202601-0001",
    "status": "draft",
    "supplier": { ... },
    "items": [ ... ],
    "history": [ ... ],
    "receipts": [ ... ],
    ...
  }
}
```

### PATCH /api/procurement/purchase-orders/[id]/status
Update PO status with action.

Request:
```json
{
  "action": "submit" | "approve" | "reject" | "send" | "acknowledge" | "cancel",
  "notes": "Optional notes"
}
```

### DELETE /api/procurement/purchase-orders/[id]
Delete a draft PO.

## Accessibility Requirements
- Proper heading hierarchy (h1 for PO number)
- Tab navigation for sections
- ARIA labels for action buttons
- Status announcements for screen readers
- Keyboard navigation for all interactive elements
