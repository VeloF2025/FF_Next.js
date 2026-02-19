# Dashboard Load

**URL**: /
**Preconditions**: User is logged in
**Priority**: Critical
**Module**: Dashboard

## Steps

1. **Navigate to dashboard**
   - Action: navigate to /
   - Expect: Page loads without errors, heading "Dashboard" or KPI cards visible

2. **Verify KPI cards render**
   - Action: look for KPI metric cards on the page
   - Expect: At least 3 KPI cards visible with numeric values (not "NaN" or "undefined")

3. **Verify no error banners**
   - Action: check for any error alerts or red banners
   - Expect: No error messages visible on the page

4. **Check sidebar navigation**
   - Action: look for sidebar navigation menu
   - Expect: Sidebar is visible with menu items (Dashboard, Projects, Staff, etc.)

5. **Verify page title**
   - Action: check browser tab title
   - Expect: Title contains "FibreFlow" or "Dashboard"
