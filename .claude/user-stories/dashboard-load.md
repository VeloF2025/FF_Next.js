# Dashboard Load

**URL**: /
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Critical
**Module**: Dashboard

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
