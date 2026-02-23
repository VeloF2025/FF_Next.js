# Maintenance Tickets

**URL**: /maintenance
**Preconditions**: Fresh browser session (auth handled in Auth section below)
**Priority**: Medium
**Module**: Maintenance

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

1. **Navigate to maintenance page**
   - Action: navigate to /maintenance
   - Expect: Page loads with Maintenance heading or ticket board visible

2. **Verify ticket display**
   - Action: look for ticket cards or Kanban columns
   - Expect: Tickets visible in columns or list format

3. **Check status columns**
   - Action: look for Kanban columns or status filters
   - Expect: Multiple status categories visible (Open, In Progress, Resolved, etc.)

4. **Click a ticket**
   - Action: click on the first ticket card
   - Expect: Ticket detail opens showing description, assignee, and status

5. **Navigate back**
   - Action: click back button or breadcrumb
   - Expect: Returns to ticket list view
