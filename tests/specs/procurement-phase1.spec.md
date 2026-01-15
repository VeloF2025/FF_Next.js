# Test Specification: PRD-050 Procurement Portal Phase 1

## Overview
**Feature**: Comprehensive Procurement Portal - Phase 1 Foundation
**PRD**: PRD-050
**Date**: 2026-01-15
**Author**: Claude (PAI)

## Scope
Phase 1 covers the foundational database tables, TypeScript types, and API endpoints for:
- Purchase Requisitions (PR)
- Goods Receipt Notes (GRN)
- Approval Workflows

---

## 1. Database Schema Tests

### 1.1 Purchase Requisitions Table
- [ ] `purchase_requisitions` table exists
- [ ] Auto-generates `requisition_number` with format `PR-YYYYMM-XXXX`
- [ ] `status` column has valid enum values
- [ ] `urgency` column defaults to 'normal'
- [ ] `requested_date` defaults to current timestamp
- [ ] Foreign key to `projects` table works correctly

### 1.2 Purchase Requisition Items Table
- [ ] `purchase_requisition_items` table exists
- [ ] Foreign key to `purchase_requisitions` cascades on delete
- [ ] `quantity` must be positive
- [ ] `estimated_total` calculated correctly

### 1.3 Goods Receipts Table
- [ ] `goods_receipts` table exists
- [ ] Auto-generates `grn_number` with format `GRN-YYYYMM-XXXX`
- [ ] Foreign key to `purchase_orders` table (nullable)
- [ ] `status` column has valid enum values

### 1.4 Approval Workflow Tables
- [ ] `approval_workflows` table exists
- [ ] `approval_levels` table exists with foreign key
- [ ] `approval_requests` table exists
- [ ] `approval_history` table exists

---

## 2. API Endpoint Tests

### 2.1 GET /api/procurement/requisitions
**Input**: Query params `page`, `limit`
**Expected Output**:
```json
{
  "success": true,
  "data": [...],
  "pagination": { "page": 1, "pageSize": 50, "total": 0, "totalPages": 0 }
}
```

**Test Cases**:
- [ ] Returns 200 with empty array when no requisitions
- [ ] Returns paginated results correctly
- [ ] Includes `project_name` from joined projects table
- [ ] Includes `item_count` subquery result
- [ ] Handles invalid page/limit gracefully

### 2.2 POST /api/procurement/requisitions
**Input**: Request body with requisition data and items
**Expected Output**:
```json
{
  "success": true,
  "data": { "id": "uuid", "requisitionNumber": "PR-202601-0001", ... }
}
```

**Test Cases**:
- [ ] Creates requisition with valid data
- [ ] Returns 400 if items array is empty
- [ ] Returns 400 if items array is missing
- [ ] Auto-generates requisition number
- [ ] Creates all items in transaction
- [ ] Calculates estimated_total for items

### 2.3 GET /api/procurement/requisitions/[id]
**Test Cases**:
- [ ] Returns 200 with full requisition and items
- [ ] Returns 404 for non-existent ID
- [ ] Includes all item details

### 2.4 PUT /api/procurement/requisitions/[id]
**Test Cases**:
- [ ] Updates requisition fields correctly
- [ ] Returns 404 for non-existent ID
- [ ] Only updates allowed fields
- [ ] Cannot update if status is not 'draft'

### 2.5 DELETE /api/procurement/requisitions/[id]
**Test Cases**:
- [ ] Deletes requisition and cascades to items
- [ ] Returns 404 for non-existent ID
- [ ] Cannot delete if status is not 'draft'

### 2.6 POST /api/procurement/requisitions/[id]/submit
**Test Cases**:
- [ ] Changes status from 'draft' to 'submitted'
- [ ] Returns 400 if already submitted
- [ ] Returns 404 for non-existent ID

### 2.7 GET /api/procurement/grn
**Test Cases**:
- [ ] Returns 200 with empty array when no GRNs
- [ ] Returns paginated results correctly

### 2.8 POST /api/procurement/grn
**Test Cases**:
- [ ] Creates GRN with valid data
- [ ] Auto-generates GRN number
- [ ] Links to purchase order if provided

### 2.9 GET /api/procurement/approvals/pending
**Test Cases**:
- [ ] Returns pending approvals for current user
- [ ] Groups by workflow type correctly
- [ ] Returns counts by type

---

## 3. TypeScript Type Tests

### 3.1 Requisition Types
- [ ] `RequisitionStatus` includes all valid statuses
- [ ] `RequisitionUrgency` includes: low, normal, high, critical
- [ ] `PurchaseRequisition` interface matches database schema
- [ ] `PurchaseRequisitionItem` interface matches database schema
- [ ] `CreateRequisitionForm` has required fields

### 3.2 GRN Types
- [ ] `GRNStatus` includes all valid statuses
- [ ] `GoodsReceiptNote` interface matches database schema
- [ ] `GRNItem` interface includes inspection fields

### 3.3 Approval Types
- [ ] `WorkflowType` includes all entity types
- [ ] `ApprovalStatus` includes: pending, approved, rejected, escalated
- [ ] `ApprovalWorkflow` interface has levels array

---

## 4. UI Component Tests

### 4.1 Requisitions List Page
- [ ] Renders loading state initially
- [ ] Renders empty state when no data
- [ ] Renders table with requisitions when data exists
- [ ] Search filters by requisition number, project, requester
- [ ] Status badges show correct colors
- [ ] Urgency shows correct styling

### 4.2 ProcurementTabs Component
- [ ] Renders 'Requisitions' tab
- [ ] Renders 'Goods Receipt' tab
- [ ] Active tab has correct styling
- [ ] Tabs navigate to correct paths

---

## 5. Integration Tests

### 5.1 Full Requisition Flow
- [ ] Create requisition with items
- [ ] Fetch requisition list
- [ ] Fetch single requisition with items
- [ ] Submit requisition
- [ ] Verify status changed

### 5.2 Database Constraints
- [ ] Cannot insert invalid status
- [ ] Cannot insert negative quantity
- [ ] Foreign key constraints enforced

---

## Acceptance Criteria
1. All API endpoints return correct response structure
2. Database tables have correct constraints and triggers
3. TypeScript types compile without errors
4. UI renders without console errors
5. All test cases pass

## Notes
- Tests should use test database, not production
- Mock authentication for API tests
- Clean up test data after each test
