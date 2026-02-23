# Construction QA Reviews List

**URL**: /construction-qa
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: High
**Module**: Construction QA

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

1. **Navigate to construction QA page**
   - Action: navigate to /construction-qa
   - Expect: Page loads with Construction QA heading or review list visible

2. **Verify page content loads**
   - Action: look for review cards, table rows, or status summary
   - Expect: Content renders (either data rows or empty state message)

3. **Check filter controls**
   - Action: look for filter dropdowns or search bar
   - Expect: At least one filter control visible (project, status, date)

4. **Test search if available**
   - Action: find search input and type a character
   - Expect: Search input accepts text, page responds (filters or shows loading)

5. **Check for console errors**
   - Action: check browser console for errors
   - Expect: No JavaScript errors on this page
