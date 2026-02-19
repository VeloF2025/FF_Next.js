# Sidebar Navigation

**URL**: /
**Preconditions**: User is logged in
**Priority**: Critical
**Module**: Navigation

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
