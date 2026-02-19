# Projects List Page

**URL**: /projects
**Preconditions**: User is logged in, at least 1 project exists
**Priority**: Critical
**Module**: Projects

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
   - Expect: Project name visible, navigation tabs present (Overview, Drops, Pipeline, etc.)
