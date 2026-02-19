# Sow — /sow/grid

**URL**: /sow/grid
**Preconditions**: User is logged in
**Priority**: Medium
**Module**: Sow
**Type**: smoke (auto-generated)

## Steps

1. **Navigate to page**
   - Action: navigate to /sow/grid
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
