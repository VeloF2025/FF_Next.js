# Test Specification: Requisition Form Page

## Overview
**Feature**: Create/Edit Purchase Requisition Form
**PRD**: PRD-050 Phase 2 - Core Procurement
**Date**: 2026-01-15
**Author**: Claude (PAI)
**Status**: Draft

## Purpose
Enable users to create and edit purchase requisitions with line items, urgency levels, and project association.

---

## 1. Page Requirements

### 1.1 Page Location
- **Route**: `/procurement/requisitions/new` (create)
- **Route**: `/procurement/requisitions/[id]/edit` (edit)

### 1.2 Access Control
- Requires authenticated user
- Permission: `canCreateRequisitions`

### 1.3 Layout
- Uses `AppLayout` with sidebar
- Header with "New Requisition" / "Edit Requisition" title
- Form sections: Details, Items, Summary

---

## 2. Form Fields

### 2.1 Header Section
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Project | Select/Search | No | Valid project ID |
| Department | Text | No | Max 100 chars |
| Required Date | Date | No | Must be future date |
| Urgency | Select | Yes | low/normal/high/critical |
| Notes | Textarea | No | Max 1000 chars |

### 2.2 Items Section
| Field | Type | Required | Validation |
|-------|------|----------|------------|
| Item Description | Text | Yes | Min 3 chars, Max 500 chars |
| Quantity | Number | Yes | > 0, max 999999 |
| UOM | Select | Yes | Valid UOM value |
| Est. Unit Price | Currency | No | >= 0 |
| Suggested Supplier | Select | No | Valid supplier ID |
| Item Notes | Text | No | Max 255 chars |

### 2.3 Summary Section (read-only, calculated)
- Item Count
- Estimated Total (sum of qty × unit price)
- Currency (ZAR default)

---

## 3. Component Tests

### 3.1 Form Rendering
- [ ] Form renders with all header fields
- [ ] Form renders empty items table
- [ ] "Add Item" button is visible
- [ ] "Submit" button is disabled when form is invalid
- [ ] "Cancel" button navigates back to list

### 3.2 Project Selection
- [ ] Project dropdown loads projects from API
- [ ] Searchable/filterable
- [ ] Shows project name and code
- [ ] Selecting project updates form state
- [ ] Can clear project selection

### 3.3 Date Picker
- [ ] Required date picker opens calendar
- [ ] Cannot select past dates
- [ ] Selecting date updates form state
- [ ] Can clear date selection

### 3.4 Urgency Selection
- [ ] Dropdown shows all urgency options
- [ ] Default value is "normal"
- [ ] Shows colored indicator per urgency level

### 3.5 Items Management
- [ ] "Add Item" adds empty row to items table
- [ ] Can remove item row (unless last item on submit)
- [ ] Item fields validate on blur
- [ ] Line total calculates automatically (qty × price)
- [ ] Can have multiple items

### 3.6 Item Field Validation
- [ ] Description required - shows error if empty on blur
- [ ] Quantity required - shows error if <= 0
- [ ] UOM required - shows error if empty
- [ ] Price accepts decimal values
- [ ] Invalid inputs show error messages

### 3.7 Summary Calculation
- [ ] Total updates when items change
- [ ] Total shows correct currency format (R XX,XXX.XX)
- [ ] Item count reflects actual items
- [ ] Handles empty prices gracefully

### 3.8 Form Submission
- [ ] Submit button enabled when form is valid
- [ ] Shows loading state during submission
- [ ] Validates all fields before submit
- [ ] On success: navigates to requisition detail
- [ ] On error: shows error message, keeps form state

### 3.9 Edit Mode
- [ ] Loads existing requisition data
- [ ] Pre-fills all header fields
- [ ] Pre-fills all item rows
- [ ] Can modify and save changes
- [ ] Cannot edit if status is not "draft"

---

## 4. API Integration Tests

### 4.1 POST /api/procurement/requisitions
**Request:**
```json
{
  "projectId": "uuid | null",
  "department": "string | null",
  "requiredDate": "YYYY-MM-DD | null",
  "urgency": "low | normal | high | critical",
  "notes": "string | null",
  "items": [
    {
      "itemDescription": "string",
      "quantity": "number",
      "uom": "string",
      "estimatedUnitPrice": "number | null",
      "suggestedSupplierId": "uuid | null",
      "notes": "string | null"
    }
  ]
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "requisitionNumber": "PR-YYYYMM-XXXX",
    "status": "draft",
    ...
  }
}
```

**Error Cases:**
- 400: Empty items array
- 400: Invalid urgency value
- 400: Item missing required fields
- 500: Database error

### 4.2 GET /api/procurement/requisitions/[id]
- [ ] Returns full requisition with items
- [ ] Returns 404 for non-existent ID

### 4.3 PUT /api/procurement/requisitions/[id]
- [ ] Updates requisition fields
- [ ] Updates/adds/removes items
- [ ] Returns 400 if status is not "draft"
- [ ] Returns 404 for non-existent ID

---

## 5. UI/UX Tests

### 5.1 Responsive Design
- [ ] Form usable on tablet (768px)
- [ ] Items table scrolls horizontally on mobile
- [ ] Buttons stack vertically on mobile

### 5.2 Accessibility
- [ ] All form fields have labels
- [ ] Error messages announced by screen readers
- [ ] Keyboard navigation works
- [ ] Focus management after add/remove item

### 5.3 Error States
- [ ] Field-level errors shown below fields
- [ ] Form-level errors shown in alert
- [ ] Network errors handled gracefully
- [ ] Can retry after error

### 5.4 Loading States
- [ ] Skeleton shown while loading data (edit mode)
- [ ] Submit button shows spinner during save
- [ ] Form disabled during submission

---

## 6. Edge Cases

### 6.1 Empty Form
- [ ] Cannot submit with zero items
- [ ] Shows helpful message to add items

### 6.2 Large Forms
- [ ] Handles 50+ items without performance issues
- [ ] Smooth scrolling in items table

### 6.3 Price Calculations
- [ ] Handles null/undefined prices
- [ ] Handles very large numbers
- [ ] Decimal precision (2 places)
- [ ] No floating point errors

### 6.4 Concurrent Edits
- [ ] Shows conflict message if requisition changed
- [ ] Option to reload and lose changes

---

## 7. Acceptance Criteria

1. User can create a new purchase requisition with 1+ items
2. All required fields validated with clear error messages
3. Estimated total calculates correctly
4. Form submits successfully and redirects to detail view
5. Edit mode loads existing data and allows modifications
6. No console errors in browser
7. All tests pass

---

## 8. Test Data

### Sample Valid Requisition
```javascript
const validRequisition = {
  projectId: '123e4567-e89b-12d3-a456-426614174000',
  department: 'Operations',
  requiredDate: '2026-02-01',
  urgency: 'high',
  notes: 'Urgent materials for Lawley project',
  items: [
    {
      itemDescription: 'Fiber Optic Cable 12-core SM',
      quantity: 500,
      uom: 'meters',
      estimatedUnitPrice: 25.50,
      suggestedSupplierId: null,
      notes: 'G.657A2 spec'
    },
    {
      itemDescription: 'Splice Closure 24-port',
      quantity: 10,
      uom: 'units',
      estimatedUnitPrice: 450.00,
      suggestedSupplierId: null,
      notes: 'IP68 rated'
    }
  ]
};
// Expected total: (500 × 25.50) + (10 × 450) = R17,250.00
```

### Sample Invalid Cases
```javascript
const invalidCases = [
  { case: 'empty items', items: [] },
  { case: 'missing description', items: [{ quantity: 10, uom: 'pcs' }] },
  { case: 'zero quantity', items: [{ itemDescription: 'Test', quantity: 0, uom: 'pcs' }] },
  { case: 'negative quantity', items: [{ itemDescription: 'Test', quantity: -5, uom: 'pcs' }] },
  { case: 'missing uom', items: [{ itemDescription: 'Test', quantity: 10 }] }
];
```

---

## 9. Dependencies

### Components Needed
- `ProjectSelector` - searchable project dropdown
- `SupplierSelector` - searchable supplier dropdown
- `DatePicker` - date selection with min date
- `CurrencyInput` - formatted currency input
- `UOMSelect` - standard unit of measure dropdown

### Hooks Needed
- `useRequisitionForm` - form state management
- `useProjects` - fetch projects for selector
- `useSuppliers` - fetch suppliers for selector

### Types Needed
- Already created in `requisition.types.ts`

---

## Notes

- Form should auto-save draft to localStorage (nice-to-have)
- Consider wizard-style flow for mobile (nice-to-have)
- Keep form state on navigation back (browser back button)
