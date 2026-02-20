# Procurement Overview

**URL**: /procurement
**Preconditions**: User is logged in
**Priority**: Critical
**Module**: Procurement

## Steps

1. **Navigate to procurement page**
   - Action: navigate to /procurement
   - Expect: Page loads with procurement tabs visible

2. **Verify tab navigation**
   - Action: look for procurement tabs (BOQ, RFQ, Requisitions, PO, GRN, Approvals, Stock, Field Stock)
   - Expect: Multiple tabs visible, at least one is active/selected

3. **Check Requisitions tab**
   - Action: click Requisitions tab or navigate to /procurement/requisitions
   - Expect: Requisition list loads with table showing columns: #, Department, Status, Urgency, Total, Date

4. **Create new requisition**
   - Action: click "New Requisition" button
   - Expect: Form loads with fields: Department, Required Date, Urgency, Items table
   - Action: fill in department, add an item with description/qty/uom/price, click Create
   - Expect: Requisition created in Draft status, redirected to detail page

5. **Submit requisition for approval**
   - Action: on requisition detail page, click "Submit" button
   - Expect: Status changes to "Pending Approval" (if >= R10,000) or "Approved" (if < R10,000)

6. **Approve requisition**
   - Action: click "Approve" button on a pending_approval requisition
   - Expect: Status changes to "Approved", approve/reject buttons disappear

7. **Reject requisition**
   - Action: click "Reject" button on a pending_approval requisition
   - Expect: Modal appears asking for rejection reason
   - Action: enter reason and click Reject
   - Expect: Status changes to "Rejected"

8. **Check Approvals page**
   - Action: navigate to /procurement/approvals
   - Expect: Pending approval tasks listed with Approve/Reject buttons, stats cards showing counts

9. **Check Purchase Orders**
   - Action: navigate to /procurement/purchase-orders
   - Expect: PO list with status badges, create button

10. **Check Field Stock**
    - Action: navigate to /procurement/field-stock
    - Expect: 8 sub-tabs visible: Dashboard, Locations, Items, Pickings, Returns, Consumptions, Accountability, Adjustments

11. **Check Inventory**
    - Action: navigate to /procurement/inventory
    - Expect: Tabs: Stock, Items, Bundles, Takes, Adjustments, Reports

12. **Check Adjustments tab**
    - Action: click Adjustments tab on Inventory or Field Stock page
    - Expect: Adjustment history table and "New Adjustment" button
    - Action: click New Adjustment
    - Expect: Form with Location, Item, Type (Increase/Decrease), Quantity, Reason, Notes

13. **Verify no console errors**
    - Action: check browser console for errors
    - Expect: No JavaScript errors related to procurement
