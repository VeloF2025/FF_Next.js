# Activate Module Overview

**URL**: /activate
**Preconditions**: User is logged in, at least 1 project with activate data exists
**Priority**: Critical
**Module**: Activate

## Steps

1. **Navigate to activate page**
   - Action: navigate to /activate
   - Expect: Page loads with Activate heading or project selector visible

2. **Verify project selector**
   - Action: look for project dropdown or selector
   - Expect: Dropdown with at least 1 project available

3. **Select a project**
   - Action: select the first available project
   - Expect: Project data loads, statistics or drop list becomes visible

4. **Verify data display**
   - Action: look for activation statistics or drop cards
   - Expect: Numeric metrics visible (total drops, completion %, etc.)

5. **Check for no errors**
   - Action: check page for error messages
   - Expect: No error banners, no "failed to load" messages
