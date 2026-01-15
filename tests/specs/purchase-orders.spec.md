# Test Specification: Purchase Orders Module

## Overview
**Feature**: Purchase Order Management
**PRD**: PRD-050 Phase 2 - Core Procurement
**Date**: 2026-01-15
**Author**: Claude (PAI)
**Status**: Draft

## Purpose
Create, manage, and track purchase orders from approved requisitions or direct creation.

---

## 1. Page Requirements

### 1.1 Pages
| Route | Purpose |
|-------|---------|
| `/procurement/purchase-orders` | List all POs |
| `/procurement/purchase-orders/new` | Create new PO |
| `/procurement/purchase-orders/[id]` | View PO detail |
| `/procurement/purchase-orders/[id]/edit` | Edit PO (draft only) |

### 1.2 Access Control
- View: `canViewPurchaseOrders`
- Create/Edit: `canCreatePurchaseOrders`
- Approve: `canApprovePurchaseOrders`

---

## 2. Data Model

### 2.1 PurchaseOrder
```typescript
interface PurchaseOrder {
  id: string;
  poNumber: string;              // PO-YYYYMM-XXXX
  status: POStatus;
  requisitionId: string | null;  // If converted from requisition
  supplierId: number;
  supplierName: string;
  projectId: string | null;
  projectName: string | null;
  deliveryAddress: string;
  deliveryDate: string | null;   // Expected delivery
  paymentTerms: string;          // Net 30, COD, etc.
  currency: string;              // ZAR default
  subtotal: number;
  vatRate: number;               // 15% default
  vatAmount: number;
  total: number;
  notes: string | null;
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedDate: string | null;
  items: POItem[];
  createdAt: string;
  updatedAt: string;
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
```

### 2.2 POItem
```typescript
interface POItem {
  id: string;
  poId: string;
  lineNumber: number;
  itemDescription: string;
  itemCode: string | null;       // SKU/Part number
  quantity: number;
  uom: string;
  unitPrice: number;
  lineTotal: number;
  quantityReceived: number;      // From GRN
  quantityPending: number;       // quantity - received
  requisitionItemId: string | null;
  notes: string | null;
}
```

---

## 3. List Page Tests

### 3.1 Rendering
- [ ] Page displays PO list table
- [ ] Shows PO number, supplier, date, total, status
- [ ] Status badges have correct colors
- [ ] Pagination works correctly
- [ ] Empty state shows when no POs

### 3.2 Filtering
- [ ] Filter by status (dropdown)
- [ ] Filter by supplier (search)
- [ ] Filter by date range
- [ ] Search by PO number
- [ ] Filters persist in URL

### 3.3 Sorting
- [ ] Default sort by date descending
- [ ] Click column header to sort
- [ ] Sort indicator shows direction

### 3.4 Actions
- [ ] "New PO" button navigates to create
- [ ] Row click navigates to detail
- [ ] Quick actions menu (if applicable)

---

## 4. Create Page Tests

### 4.1 Form Fields
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Supplier | Select | Yes | Valid supplier ID |
| Project | Select | No | Valid project ID |
| Delivery Address | Textarea | Yes | Min 10 chars |
| Expected Delivery | Date | No | Future date |
| Payment Terms | Select | Yes | Valid term |
| Currency | Select | Yes | ZAR/USD/EUR |
| Notes | Textarea | No | Max 1000 chars |

### 4.2 Items Section
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Description | Text | Yes | Min 3 chars |
| Item Code | Text | No | Max 50 chars |
| Quantity | Number | Yes | > 0 |
| UOM | Select | Yes | Valid UOM |
| Unit Price | Currency | Yes | >= 0 |

### 4.3 Summary Section
- Subtotal (sum of line totals)
- VAT Rate selector (0%, 15%)
- VAT Amount (calculated)
- Grand Total (subtotal + VAT)

### 4.4 Calculations
- [ ] Line total = qty × unit price
- [ ] Subtotal = sum of line totals
- [ ] VAT = subtotal × rate
- [ ] Total = subtotal + VAT
- [ ] All calculations update in real-time

### 4.5 Submission
- [ ] Validates all required fields
- [ ] Shows loading state
- [ ] Success redirects to detail
- [ ] Error shows message

---

## 5. Detail Page Tests

### 5.1 Header
- [ ] Shows PO number and status
- [ ] Action buttons based on status
- [ ] Print button available

### 5.2 Status Actions
| Status | Actions |
|--------|---------|
| draft | Edit, Submit, Delete |
| pending_approval | Approve, Reject |
| approved | Send to Supplier, Cancel |
| sent | Mark Acknowledged |
| acknowledged | Create GRN |
| partial_receipt | Create GRN |
| completed | No actions |

### 5.3 Information Display
- [ ] Supplier details card
- [ ] Delivery information card
- [ ] Payment terms
- [ ] Items table with received quantities
- [ ] Totals summary
- [ ] Linked documents (GRNs, Invoices)

### 5.4 Receipt Tracking
- [ ] Shows received vs ordered for each line
- [ ] Visual indicator for partial/complete
- [ ] Links to related GRNs

---

## 6. API Tests

### 6.1 GET /api/procurement/purchase-orders
**Query Parameters:**
- page, pageSize (pagination)
- status (filter)
- supplierId (filter)
- search (PO number search)
- sortBy, sortDir

**Response:**
```json
{
  "success": true,
  "data": [POListItem],
  "pagination": { "page": 1, "pageSize": 50, "total": 100 }
}
```

### 6.2 POST /api/procurement/purchase-orders
**Request:**
```json
{
  "supplierId": 1,
  "projectId": "uuid | null",
  "deliveryAddress": "string",
  "deliveryDate": "YYYY-MM-DD | null",
  "paymentTerms": "Net 30",
  "currency": "ZAR",
  "vatRate": 15,
  "notes": "string | null",
  "items": [{
    "itemDescription": "string",
    "itemCode": "string | null",
    "quantity": "number",
    "uom": "string",
    "unitPrice": "number"
  }]
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "poNumber": "PO-202601-0001"
  }
}
```

### 6.3 GET /api/procurement/purchase-orders/[id]
**Response:**
```json
{
  "success": true,
  "data": PurchaseOrder
}
```

### 6.4 PATCH /api/procurement/purchase-orders/[id]/status
**Request:**
```json
{
  "action": "submit | approve | reject | send | acknowledge | cancel",
  "notes": "string | null"
}
```

---

## 7. Calculation Tests

### 7.1 Line Total
```javascript
const calculateLineTotal = (qty, unitPrice) => {
  return Math.round(qty * unitPrice * 100) / 100;
};

// Tests
expect(calculateLineTotal(10, 100)).toBe(1000);
expect(calculateLineTotal(5, 25.50)).toBe(127.50);
expect(calculateLineTotal(3, 33.33)).toBe(99.99);
```

### 7.2 VAT Calculation
```javascript
const calculateVAT = (subtotal, rate) => {
  return Math.round(subtotal * (rate / 100) * 100) / 100;
};

// Tests (15% VAT)
expect(calculateVAT(1000, 15)).toBe(150);
expect(calculateVAT(12750, 15)).toBe(1912.50);
expect(calculateVAT(0, 15)).toBe(0);
```

### 7.3 Grand Total
```javascript
const calculateTotal = (subtotal, vatAmount) => {
  return Math.round((subtotal + vatAmount) * 100) / 100;
};

// Tests
expect(calculateTotal(1000, 150)).toBe(1150);
expect(calculateTotal(12750, 1912.50)).toBe(14662.50);
```

---

## 8. Status State Machine

```
                    ┌──────────────┐
                    │    DRAFT     │
                    └──────┬───────┘
                           │ submit
                           ▼
                    ┌──────────────┐
         ┌──────────│   PENDING    │──────────┐
         │ reject   │   APPROVAL   │          │
         │          └──────┬───────┘          │
         ▼                 │ approve          │
  ┌──────────────┐         ▼                  │
  │    DRAFT     │  ┌──────────────┐          │
  └──────────────┘  │   APPROVED   │          │
                    └──────┬───────┘          │
                           │ send             │
                           ▼                  │
                    ┌──────────────┐          │
                    │     SENT     │──────────┤
                    └──────┬───────┘ cancel   │
                           │ acknowledge      │
                           ▼                  │
                    ┌──────────────┐          │
         ┌──────────│ ACKNOWLEDGED │──────────┤
         │          └──────┬───────┘          │
         │                 │ receive          │
         │                 ▼                  ▼
         │          ┌──────────────┐   ┌──────────────┐
         │          │   PARTIAL    │   │  CANCELLED   │
         │          │   RECEIPT    │   └──────────────┘
         │          └──────┬───────┘
         │                 │ complete
         │                 ▼
         │          ┌──────────────┐
         └─────────►│  COMPLETED   │
                    └──────────────┘
```

---

## 9. Test Data

### Sample PO
```javascript
const samplePO = {
  id: 'po-123',
  poNumber: 'PO-202601-0001',
  status: 'approved',
  supplierId: 1,
  supplierName: 'ABC Fibre Supplies',
  projectId: 'proj-123',
  projectName: 'Lawley Phase 2',
  deliveryAddress: '123 Main Street, Johannesburg, 2000',
  deliveryDate: '2026-02-01',
  paymentTerms: 'Net 30',
  currency: 'ZAR',
  subtotal: 17250,
  vatRate: 15,
  vatAmount: 2587.50,
  total: 19837.50,
  items: [
    {
      id: 'item-1',
      lineNumber: 1,
      itemDescription: 'Fiber Optic Cable 12-core SM',
      itemCode: 'FOC-12-SM',
      quantity: 500,
      uom: 'meters',
      unitPrice: 25.50,
      lineTotal: 12750,
      quantityReceived: 0,
      quantityPending: 500
    },
    {
      id: 'item-2',
      lineNumber: 2,
      itemDescription: 'Splice Closure 24-port',
      itemCode: 'SC-24',
      quantity: 10,
      uom: 'units',
      unitPrice: 450,
      lineTotal: 4500,
      quantityReceived: 0,
      quantityPending: 10
    }
  ]
};
```

---

## 10. Acceptance Criteria

1. User can create PO with supplier and items
2. VAT calculates correctly at 15%
3. PO workflow progresses through all statuses
4. Receipt tracking shows quantities received
5. PDF export generates correct document
6. All validations show clear error messages
7. Zero console errors
8. All tests pass

---

## 11. Payment Terms Options
```javascript
const PAYMENT_TERMS = [
  { value: 'cod', label: 'Cash on Delivery (COD)' },
  { value: 'net7', label: 'Net 7 Days' },
  { value: 'net14', label: 'Net 14 Days' },
  { value: 'net30', label: 'Net 30 Days' },
  { value: 'net60', label: 'Net 60 Days' },
  { value: 'eom', label: 'End of Month' },
  { value: 'prepaid', label: 'Prepaid' },
];
```

---

## 12. Currency Options
```javascript
const CURRENCIES = [
  { value: 'ZAR', label: 'South African Rand (R)', symbol: 'R' },
  { value: 'USD', label: 'US Dollar ($)', symbol: '$' },
  { value: 'EUR', label: 'Euro (€)', symbol: '€' },
];
```
