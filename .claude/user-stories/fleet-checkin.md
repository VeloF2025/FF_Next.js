# Fleet Check-in Page

**URL**: /fleet
**Preconditions**: User is logged in
**Priority**: Medium
**Module**: Fleet

## Steps

1. **Navigate to fleet page**
   - Action: navigate to /fleet
   - Expect: Page loads with Fleet heading or vehicle list visible

2. **Verify vehicle list renders**
   - Action: look for vehicle cards or table
   - Expect: At least 1 vehicle visible with registration/name

3. **Check vehicle status indicators**
   - Action: look for status badges on vehicles
   - Expect: Vehicles show status (checked in, checked out, etc.)

4. **Click a vehicle**
   - Action: click on the first vehicle card or row
   - Expect: Vehicle detail or check-in form appears

5. **Verify no errors**
   - Action: check for error messages on the page
   - Expect: No error banners or broken layouts
