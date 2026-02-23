# Sidebar Navigation

**URL**: /
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Critical
**Module**: Navigation

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

1. **Navigate to home**
   - Action: navigate to /
   - Expect: Dashboard loads with sidebar visible

2. **Verify sidebar sections**
   - Action: read sidebar navigation items
   - Expect: Sections visible including Dashboard, Projects, and at least 3 other menu groups

3. **Navigate to Projects via sidebar**
   - Action: click "Projects" in the sidebar
   - Expect: URL changes to /projects, projects page loads

4. **Navigate to Staff via sidebar**
   - Action: click "Staff" in the sidebar
   - Expect: URL changes to /staff, staff page loads

5. **Navigate to Procurement via sidebar**
   - Action: click "Procurement" in the sidebar
   - Expect: URL changes to /procurement, procurement page loads

6. **Navigate back to Dashboard**
   - Action: click "Dashboard" in the sidebar
   - Expect: URL changes to /, dashboard loads again

7. **Verify active state highlighting**
   - Action: check which sidebar item is highlighted/active
   - Expect: "Dashboard" item has active/selected visual state
