# Test Specification: Requisition Detail Page

## Overview
**Feature**: View/Manage Purchase Requisition Detail
**PRD**: PRD-050 Phase 2 - Core Procurement
**Date**: 2026-01-15
**Author**: Claude (PAI)
**Status**: Draft

## Purpose
Display full requisition details with items, status history, and action buttons for workflow progression.

---

## 1. Page Requirements

### 1.1 Page Location
- **Route**: `/procurement/requisitions/[id]`

### 1.2 Access Control
- Requires authenticated user
- Permission: `canViewRequisitions`
- Edit actions require: `canEditRequisitions`
- Approve actions require: `canApproveRequisitions`

### 1.3 Layout
- Uses `AppLayout` with sidebar
- Header with requisition number, status badge, action buttons
- Tabs: Details | Items | History | Documents

---

## 2. Header Section

### 2.1 Display Fields
| Field | Type | Description |
|-------|------|-------------|
| Requisition Number | Text | PR-YYYYMM-XXXX format |
| Status Badge | Badge | Color-coded status |
| Created Date | Date | When created |
| Created By | Text | User name |

### 2.2 Action Buttons (based on status)
| Status | Actions Available |
|--------|-------------------|
| draft | Edit, Submit, Delete |
| submitted | Recall (by creator) |
| pending_approval | Approve, Reject (by approver) |
| approved | Convert to PO, Convert to RFQ |
| rejected | Edit, Resubmit |
| ordered | View PO link |
| closed | No actions |

---

## 3. Details Tab

### 3.1 Information Cards
| Card | Fields |
|------|--------|
| Project Info | Project name, code, client |
| Request Info | Department, Required date, Urgency |
| Summary | Item count, Estimated total |
| Notes | Requisition notes |

### 3.2 Approval Info (if applicable)
- Approved/Rejected by
- Approval date
- Approval notes

---

## 4. Items Tab

### 4.1 Items Table
| Column | Description |
|--------|-------------|
| # | Line number |
| Description | Item description |
| Quantity | Requested quantity |
| UOM | Unit of measure |
| Est. Unit Price | Estimated price |
| Line Total | Qty × Price |
| Supplier | Suggested supplier |
| Notes | Item notes |

### 4.2 Summary Row
- Total items count
- Grand total (ZAR)

---

## 5. History Tab

### 5.1 Timeline Display
| Event Type | Information |
|------------|-------------|
| Created | User, timestamp |
| Submitted | User, timestamp |
| Approved/Rejected | User, timestamp, notes |
| Converted | Link to PO/RFQ |
| Modified | User, changes summary |

---

## 6. Component Tests

### 6.1 Page Rendering
- [ ] Page loads with requisition data
- [ ] Shows loading skeleton while fetching
- [ ] Shows error state if fetch fails
- [ ] Shows 404 if requisition not found
- [ ] Header displays correct requisition number
- [ ] Status badge has correct color

### 6.2 Status Badge Colors
- [ ] draft: gray
- [ ] submitted: blue
- [ ] pending_approval: yellow/orange
- [ ] approved: green
- [ ] rejected: red
- [ ] ordered: purple
- [ ] closed: gray

### 6.3 Action Buttons
- [ ] Draft shows Edit, Submit, Delete
- [ ] Submitted shows Recall for creator only
- [ ] Pending shows Approve/Reject for approvers
- [ ] Approved shows Convert options
- [ ] Rejected shows Edit, Resubmit
- [ ] Buttons disabled during action processing

### 6.4 Details Tab
- [ ] Project card shows project info or "No project"
- [ ] Request info shows all fields
- [ ] Summary shows correct totals
- [ ] Notes card shows notes or placeholder

### 6.5 Items Tab
- [ ] Table renders all items
- [ ] Line numbers are sequential
- [ ] Line totals calculate correctly
- [ ] Grand total sums all lines
- [ ] Empty price shows "-"
- [ ] Suggested supplier shows name or "-"

### 6.6 History Tab
- [ ] Timeline shows all events
- [ ] Events ordered newest first
- [ ] Each event shows user and timestamp
- [ ] Approval events show notes

### 6.7 Actions
- [ ] Submit changes status to submitted
- [ ] Approve changes status to approved
- [ ] Reject changes status to rejected
- [ ] Delete removes requisition (draft only)
- [ ] Convert navigates to PO/RFQ creation

---

## 7. API Integration Tests

### 7.1 GET /api/procurement/requisitions/[id]
**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "requisitionNumber": "PR-202601-0001",
    "status": "draft",
    "projectId": "uuid | null",
    "projectName": "string | null",
    "projectCode": "string | null",
    "department": "string | null",
    "requiredDate": "YYYY-MM-DD | null",
    "urgency": "low | normal | high | critical",
    "notes": "string | null",
    "estimatedTotal": "number",
    "itemCount": "number",
    "requestedBy": "uuid",
    "requestedByName": "string",
    "requestedDate": "YYYY-MM-DD",
    "approvedBy": "uuid | null",
    "approvedByName": "string | null",
    "approvedDate": "YYYY-MM-DD | null",
    "approvalNotes": "string | null",
    "items": [
      {
        "id": "uuid",
        "lineNumber": 1,
        "itemDescription": "string",
        "quantity": "number",
        "uom": "string",
        "estimatedUnitPrice": "number | null",
        "lineTotal": "number",
        "suggestedSupplierId": "number | null",
        "suggestedSupplierName": "string | null",
        "notes": "string | null"
      }
    ],
    "history": [
      {
        "id": "uuid",
        "action": "created | submitted | approved | rejected | modified",
        "userId": "uuid",
        "userName": "string",
        "timestamp": "ISO8601",
        "notes": "string | null"
      }
    ],
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
}
```

**Error Cases:**
- 404: Requisition not found
- 403: No permission to view
- 500: Database error

### 7.2 PATCH /api/procurement/requisitions/[id]/status
**Request:**
```json
{
  "action": "submit | approve | reject | recall | delete",
  "notes": "string | null"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "new_status",
    "message": "Requisition submitted successfully"
  }
}
```

**Error Cases:**
- 400: Invalid action for current status
- 403: No permission for action
- 404: Requisition not found

---

## 8. Workflow State Machine

```
                    ┌──────────────┐
                    │    DRAFT     │
                    └──────┬───────┘
                           │ submit
                           ▼
                    ┌──────────────┐
         ┌──────────│  SUBMITTED   │──────────┐
         │ recall   └──────┬───────┘          │
         │                 │ route            │
         ▼                 ▼                  │
  ┌──────────────┐  ┌──────────────┐          │
  │    DRAFT     │  │   PENDING    │          │
  └──────────────┘  │   APPROVAL   │          │
                    └──────┬───────┘          │
                           │                  │
              ┌────────────┼────────────┐     │
              │ approve    │            │     │
              ▼            │ reject     ▼     │
       ┌──────────────┐    │     ┌──────────────┐
       │   APPROVED   │    │     │   REJECTED   │
       └──────┬───────┘    │     └──────┬───────┘
              │            │            │ edit
              │ convert    │            ▼
              ▼            │     ┌──────────────┐
       ┌──────────────┐    │     │    DRAFT     │
       │   ORDERED    │    │     └──────────────┘
       └──────┬───────┘    │
              │            │
              │ complete   │
              ▼            │
       ┌──────────────┐    │
       │    CLOSED    │◄───┘
       └──────────────┘
```

---

## 9. Test Data

### Sample Requisition (Full)
```javascript
const fullRequisition = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  requisitionNumber: 'PR-202601-0001',
  status: 'approved',
  projectId: 'proj-123',
  projectName: 'Lawley Phase 2',
  projectCode: 'LAW-002',
  department: 'Operations',
  requiredDate: '2026-02-01',
  urgency: 'high',
  notes: 'Urgent materials for Lawley project',
  estimatedTotal: 17250,
  itemCount: 2,
  requestedBy: 'user-123',
  requestedByName: 'John Doe',
  requestedDate: '2026-01-15',
  approvedBy: 'user-456',
  approvedByName: 'Jane Manager',
  approvedDate: '2026-01-16',
  approvalNotes: 'Approved - within budget',
  items: [
    {
      id: 'item-1',
      lineNumber: 1,
      itemDescription: 'Fiber Optic Cable 12-core SM',
      quantity: 500,
      uom: 'meters',
      estimatedUnitPrice: 25.50,
      lineTotal: 12750,
      suggestedSupplierId: null,
      suggestedSupplierName: null,
      notes: 'G.657A2 spec'
    },
    {
      id: 'item-2',
      lineNumber: 2,
      itemDescription: 'Splice Closure 24-port',
      quantity: 10,
      uom: 'units',
      estimatedUnitPrice: 450,
      lineTotal: 4500,
      suggestedSupplierId: 1,
      suggestedSupplierName: 'ABC Fibre Supplies',
      notes: 'IP68 rated'
    }
  ],
  history: [
    {
      id: 'hist-3',
      action: 'approved',
      userId: 'user-456',
      userName: 'Jane Manager',
      timestamp: '2026-01-16T09:30:00Z',
      notes: 'Approved - within budget'
    },
    {
      id: 'hist-2',
      action: 'submitted',
      userId: 'user-123',
      userName: 'John Doe',
      timestamp: '2026-01-15T14:00:00Z',
      notes: null
    },
    {
      id: 'hist-1',
      action: 'created',
      userId: 'user-123',
      userName: 'John Doe',
      timestamp: '2026-01-15T10:00:00Z',
      notes: null
    }
  ],
  createdAt: '2026-01-15T10:00:00Z',
  updatedAt: '2026-01-16T09:30:00Z'
};
```

---

## 10. Acceptance Criteria

1. User can view complete requisition details
2. Status badge reflects current state correctly
3. Action buttons show based on status and permissions
4. Items table displays all line items with totals
5. History timeline shows all events chronologically
6. Status transitions work correctly via action buttons
7. Error states handled gracefully
8. No console errors in browser
9. All tests pass

---

## 11. Dependencies

### Components Needed
- `StatusBadge` - Colored status indicator
- `ActionButton` - Status-based action buttons
- `ItemsTable` - Read-only items display
- `HistoryTimeline` - Event timeline

### Existing Components to Reuse
- `AppLayout` - Page layout
- `ProcurementTabs` - Navigation tabs

### Types Needed
- Already exist in `requisition.types.ts`
- May need `RequisitionDetail` extended type
