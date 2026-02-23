# Projects List Page

**URL**: /projects
**Preconditions**: Fresh browser session (auth handled in Auth section below), at least 1 project exists
**Priority**: Critical
**Module**: Projects

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

1. **Navigate to projects page**
   - Action: navigate to /projects
   - Expect: Page loads with "Projects" heading visible

2. **Verify project cards or table render**
   - Action: look for project cards or table rows
   - Expect: At least 1 project visible with project name

3. **Verify project details visible**
   - Action: check that project cards show key info
   - Expect: Each project shows name, status, and at least one metric

4. **Click a project**
   - Action: click on the first project card or row
   - Expect: Navigates to project detail page

5. **Verify project detail page**
   - Action: check for project name heading and tabs
   - Expect: Project name visible as h1, navigation tabs present — actual tabs are: Overview, Work 1, Contracts, Planning, Build, Operations, Finance
