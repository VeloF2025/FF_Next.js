# Staff Create Flow

**URL**: /staff
**Preconditions**: User is logged in with create permissions
**Priority**: Critical
**Module**: Staff
**Note**: This story creates a test record - use on dev/staging only

## Steps

1. **Navigate to staff page**
   - Action: navigate to /staff
   - Expect: Staff list page loads

2. **Click create button**
   - Action: find and click "Add Staff" or "New Staff" or "+" button
   - Expect: Create form or modal appears with input fields

3. **Verify minimal form fields**
   - Action: look for form fields
   - Expect: Name, email, and phone fields visible (minimal create form)

4. **Fill in required fields**
   - Action: type "QA Test User" in name field, "qatest@fibreflow.test" in email, "0000000000" in phone
   - Expect: Fields accept input, no validation errors shown yet

5. **Submit the form**
   - Action: click Save/Create/Submit button
   - Expect: Form submits, either redirects to new staff detail page or shows success message

6. **Verify creation succeeded**
   - Action: check for success toast/message or new staff detail page
   - Expect: "QA Test User" name visible on detail page, auto-generated Employee ID (VFxxx) shown
