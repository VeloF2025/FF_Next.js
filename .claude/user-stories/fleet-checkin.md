# Fleet Check-in Page

**URL**: /fleet
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Medium
**Module**: Fleet

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
