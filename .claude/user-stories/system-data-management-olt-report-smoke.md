# System — /system/data-management/olt-report

**URL**: /system/data-management/olt-report
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Medium
**Module**: System
**Type**: smoke (auto-generated)

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

1. **Navigate to page**
   - Action: navigate to /system/data-management/olt-report
   - Expect: Page loads without redirecting to login

2. **Verify content renders**
   - Action: check page body for content
   - Expect: Page has visible content (not blank or empty state only)

3. **No data errors**
   - Action: check page text for NaN, undefined, [object Object]
   - Expect: None of these error strings present in page content

4. **No console errors**
   - Action: check browser console
   - Expect: No JavaScript errors logged
