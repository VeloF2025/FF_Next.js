# Test Specification: Purchase Order Create Form

## Overview
Form for creating new purchase orders with supplier selection, delivery details, payment terms, and line items.

## Route
- **Path**: `/procurement/purchase-orders/new`
- **Method**: Form submission to `POST /api/procurement/purchase-orders`

## Form Sections

### 1. Supplier Selection (Required)
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Supplier | Searchable dropdown | Yes | Must select valid supplier |
| Supplier Contact | Text | No | Max 100 chars |
| Supplier Reference | Text | No | Max 50 chars (e.g., quote number) |

### 2. Project Assignment (Optional)
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Project | Searchable dropdown | No | Must be valid project if selected |

### 3. Delivery Information
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Delivery Address | Textarea | Yes | Min 10 chars |
| Expected Delivery Date | Date picker | No | Must be future date if set |
| Shipping Method | Select | No | Options: Standard, Express, Pickup |

### 4. Payment Terms
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Payment Terms | Select | Yes | Options: COD, Net 15, Net 30, Net 45, Net 60 |
| Currency | Select | Yes | Default: ZAR, Options: ZAR, USD, EUR |
| Tax Rate | Number | Yes | Default: 15, Range: 0-25 |

### 5. Line Items (At least 1 required)
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Item Code | Text | No | Max 50 chars |
| Description | Text | Yes | Min 3 chars, Max 500 chars |
| Quantity | Number | Yes | Min 1, Max 999999 |
| UOM | Select/Text | Yes | Options: pcs, rolls, m, kg, box, set |
| Unit Price | Currency | Yes | Min 0.01 |
| Notes | Text | No | Max 200 chars |

### 6. Notes
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Internal Notes | Textarea | No | Max 1000 chars |
| Supplier Notes | Textarea | No | Max 1000 chars (visible on PO) |

## Calculated Fields (Read-only)
- Line Total = Quantity × Unit Price (per item)
- Subtotal = Sum of all Line Totals
- Tax Amount = Subtotal × (Tax Rate / 100)
- Total Amount = Subtotal + Tax Amount

## Test Cases

### Form Rendering
1. Form renders with all required sections
2. Supplier dropdown loads supplier list
3. Project dropdown loads project list
4. Payment terms defaults to "Net 30"
5. Currency defaults to "ZAR"
6. Tax rate defaults to 15%
7. At least one empty line item row is shown

### Supplier Selection
8. Supplier search filters results
9. Selecting supplier populates supplier_id
10. Supplier contact info shown after selection
11. Cannot submit without selecting supplier

### Line Items Management
12. Can add new line item row
13. Can remove line item row (if more than 1)
14. Cannot remove last line item
15. Line total calculates automatically
16. Subtotal updates when items change
17. Tax amount calculates from subtotal
18. Total amount = subtotal + tax

### Validation
19. Shows error if no supplier selected
20. Shows error if no line items
21. Shows error if line item missing description
22. Shows error if line item missing quantity
23. Shows error if line item missing unit price
24. Shows error if delivery address too short
25. Shows error if quantity is negative or zero
26. Shows error if unit price is negative

### Form Submission
27. Submit creates PO with status "draft"
28. Submit generates unique PO number (PO-YYYY-NNNN)
29. Success redirects to PO detail page
30. Error shows toast notification
31. Submit button disabled while submitting

### Cancel/Navigation
32. Cancel button returns to PO list
33. Unsaved changes prompt before navigation

## API Request Format
```json
{
  "supplierId": 1,
  "supplierContact": "John Doe",
  "supplierReference": "QT-2026-001",
  "projectId": "uuid-or-null",
  "deliveryAddress": "123 Main St, City",
  "expectedDeliveryDate": "2026-02-15",
  "shippingMethod": "standard",
  "paymentTerms": "Net 30",
  "currency": "ZAR",
  "taxRate": 15,
  "internalNotes": "Internal note",
  "supplierNotes": "Note for supplier",
  "items": [
    {
      "itemCode": "FIBRE-100",
      "description": "Fibre cable 100m",
      "quantity": 10,
      "uom": "rolls",
      "unitPrice": 50.00,
      "notes": "Optional note"
    }
  ]
}
```

## API Response Format
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "poNumber": "PO-2026-0002",
    "status": "draft",
    "totalAmount": 575.00
  }
}
```

## Error States
- Network error: "Failed to create purchase order. Please try again."
- Validation error: Field-specific messages
- Server error: "An unexpected error occurred."

## Accessibility
- All form fields have labels
- Error messages associated with fields
- Tab navigation works correctly
- Submit on Enter (when not in textarea)
