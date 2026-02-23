# Activate Module Overview

**URL**: /activate
**Preconditions**: Fresh browser session (auth handled in Auth section below), at least 1 project with activate data exists
**Priority**: Critical
**Module**: Activate

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

1. **Navigate to activate page**
   - Action: navigate to /activate (use sidebar Activate link if direct URL has SPA issues)
   - Expect: Page loads with "Activate" heading and subtitle "DR photo QA and activation management"

2. **Verify date-range filter buttons**
   - Action: look for date-range filter buttons on the page
   - Expect: Buttons visible: Today, Yesterday, Last 7 days, All

3. **Verify stat cards render**
   - Action: look for stat cards / metric cards on the page
   - Expect: 5 stat cards visible: Total Drops, Installed, Activated, Not Reviewed, Reviewed — all with numeric values (may be 0 if no data for selected date range)

4. **Verify Numbers per Project table**
   - Action: look for a table or list showing project breakdown
   - Expect: "Numbers per Project" table visible (may be empty if no drops today); click "All" date filter to see data across all time

5. **Check search box**
   - Action: look for search input on the page
   - Expect: Search box present with placeholder "Search drop number or project..."

6. **Check for no errors**
   - Action: check page for error messages and browser console
   - Expect: No error banners, no "failed to load" messages, no JavaScript errors
