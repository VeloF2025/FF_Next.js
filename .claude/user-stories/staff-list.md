# Staff List Page

**URL**: /staff
**Preconditions**: User is logged in, at least 1 staff member exists
**Priority**: Critical
**Module**: Staff

## Steps

1. **Navigate to staff page**
   - Action: navigate to /staff
   - Expect: Page loads with "Staff" heading visible

2. **Verify staff table renders**
   - Action: look for data table or list of staff members
   - Expect: Table with rows visible, not empty state message

3. **Verify table columns**
   - Action: check table headers
   - Expect: Columns include Name, Employee ID, and at least one other field

4. **Test search functionality**
   - Action: find search input and type "VF"
   - Expect: Table filters to show results matching "VF" or shows filtered count

5. **Clear search**
   - Action: clear the search input
   - Expect: Full staff list returns

6. **Click a staff member**
   - Action: click on the first staff row/name link
   - Expect: Navigates to staff detail page with employee profile visible
