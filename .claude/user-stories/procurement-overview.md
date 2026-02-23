# Procurement Overview

**URL**: /procurement
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Critical
**Module**: Procurement

## Auth

**Login flow** — run before story steps if not already authenticated (sidebar not visible):

1. Navigate to `{BASE_URL}/sign-in`
2. Fill the **Email** field (`id="username"`) with `hein@velocityfibre.co.za`
3. Press **Enter** or click **Continue**
4. Wait for the password field to appear (multi-step form)
5. Fill the **Password** field (`id="current-password"`) with `Mitzi@0203`
6. Click the **Sign In** button
7. Wait for redirect — confirm the sidebar navigation is visible

> Skip this section if already logged in (sidebar already visible on screen).

## Steps

1. **Navigate to procurement page**
   - Action: navigate to /procurement
   - Expect: Page loads with procurement tabs visible

2. **Verify tab navigation**
   - Action: look for procurement category tabs at the top
   - Expect: Tabs visible: Dashboard, Sourcing, Purchasing, Inventory, Field Stock, Approvals, Reports — at least one active/selected

3. **Check Requisitions tab**
   - Action: click Requisitions tab or navigate to /procurement/requisitions
   - Expect: Requisition list loads with table showing columns: PR#, Project, Status, Items, Total

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
    - Expect: Sub-tabs visible: Dashboard, Locations, Serials, Consumptions, Transfers, Returns, Accountability, Faults, Adjustments (9 tabs)

11. **Check Inventory**
    - Action: navigate to /procurement/inventory
    - Expect: Tabs: Stock, Items, Categories, Bundles, Takes, Adjustments, Reports

12. **Check Adjustments tab**
    - Action: click Adjustments tab on Inventory or Field Stock page
    - Expect: Adjustment history table and "New Adjustment" button
    - Action: click New Adjustment
    - Expect: Form with Location, Item, Type (Increase/Decrease), Quantity, Reason, Notes

13. **Verify no console errors**
    - Action: check browser console for errors
    - Expect: No JavaScript errors related to procurement
