# Procurement Overview

**URL**: /procurement
**Preconditions**: User is logged in
**Priority**: Critical
**Module**: Procurement

## Steps

1. **Navigate to procurement page**
   - Action: navigate to /procurement
   - Expect: Page loads with "Procurement" heading or tab bar visible

2. **Verify tab navigation**
   - Action: look for procurement tabs (BOQ, RFQ, PO, etc.)
   - Expect: Multiple tabs visible, at least one is active/selected

3. **Check BOQ tab**
   - Action: click BOQ tab if not already active
   - Expect: BOQ content loads, table or list visible

4. **Check RFQ tab**
   - Action: click RFQ tab
   - Expect: RFQ list loads with status indicators

5. **Verify no console errors**
   - Action: check browser console for errors
   - Expect: No JavaScript errors related to procurement
