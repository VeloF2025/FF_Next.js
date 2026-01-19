# E2E Production Test

Pre-deployment production readiness testing for FibreFlow modules. Execute comprehensive functional and visual tests before going live.

## Usage

- `/e2e <module>` - Full production test for a module
- `/e2e <module> --theme=dark` - Test specific theme only
- `/e2e <module> --quick` - Quick smoke test (critical paths only)
- `/e2e list` - Show available modules

## Arguments

$ARGUMENTS

## Available Modules

| Module | Key Flows | Critical APIs |
|--------|-----------|---------------|
| `rfq` | Create, View, Edit, Convert to PO | `/api/procurement/rfq/*` |
| `boq` | Create, Import, Link to Project | `/api/procurement/boq/*` |
| `suppliers` | Create, Edit, Documents, Delete | `/api/suppliers/*` |
| `activate` | DR Review, VLM Categorization, Feedback | `/api/activate/*` |
| `fleet` | Vehicle CRUD, Inspections, Fuel | `/api/fleet/*` |
| `projects` | Create, Tracker, SOW Import | `/api/projects/*` |
| `procurement` | Full workflow: BOQ→RFQ→PO→GRN | All procurement APIs |

## Test Protocol

### Phase 1: Environment Check
```
1. Verify server running at localhost:3005
2. Check database connectivity via /api/health
3. Verify user authentication
4. Record initial state (counts, IDs)
```

### Phase 2: Theme Testing (Both Light & Dark)
For EACH theme:
```
1. Set theme via UI toggle
2. Take baseline screenshot
3. Execute all functional tests
4. Capture screenshots at each step
5. Check for:
   - White/light backgrounds in dark mode
   - Unreadable text (contrast issues)
   - Missing borders/separators
   - Broken hover states
   - Modal/dropdown visibility
6. CRITICAL: Compare styling to similar pages
   - Compare list pages to each other (RFQ vs Suppliers vs BOQ)
   - Verify stat cards present and styled consistently
   - Verify card/list layout matches other modules
   - Check that same CSS variables are used
```

### Phase 2.5: Cross-Page Styling Consistency
BEFORE marking theme tests complete:
```
1. Open reference page (e.g., /suppliers for procurement modules)
2. Take screenshot of reference page
3. Open test page (e.g., /procurement/rfq)
4. Compare visually:
   - Same background colors?
   - Same card/list styling?
   - Same stat card pattern?
   - Same header layout?
5. If mismatch found → FIX before continuing
```

### Phase 3: Functional Tests
Execute CRUD operations with REAL data:
```
CREATE:
- Fill all required fields with valid test data
- Submit and verify success toast/response
- Verify data persisted (refresh and check)

READ:
- Verify list shows created item
- Verify detail view loads correctly
- Check all data fields display properly

UPDATE:
- Modify key fields
- Submit and verify changes persisted
- Check audit trail if applicable

DELETE (if applicable):
- Test soft delete behavior
- Verify item removed from lists
- Check cascade/dependency handling
```

### Phase 4: Edge Cases & Error Handling
```
1. Submit empty required fields → expect validation errors
2. Submit invalid data types → expect proper error messages
3. Test duplicate prevention → expect conflict handling
4. Test concurrent access (if applicable)
5. Test network failure recovery
```

### Phase 5: Console & Network Audit
```
1. Check browser console for:
   - JavaScript errors
   - Failed API calls (4xx, 5xx)
   - React warnings
   - Deprecation notices

2. Check network tab for:
   - Failed requests
   - Slow responses (>3s)
   - Missing resources (404s)
```

## Test Data Conventions

Use identifiable test data that can be cleaned up:
```
Title/Name: "E2E Test - [Module] - [Timestamp]"
Description: "Automated E2E test - safe to delete"
```

## Output Format

```markdown
# E2E Production Test Report
## Module: [module_name]
## Date: [timestamp]
## Tester: Claude Code

### Environment
- Server: localhost:3005
- Database: [connection status]
- Theme Tests: Dark ✓ | Light ✓

### Test Results

| Test Case | Dark Mode | Light Mode | Status |
|-----------|-----------|------------|--------|
| TC-001: Create | PASS | PASS | ✓ |
| TC-002: Read | PASS | PASS | ✓ |
| TC-003: Update | PASS | FAIL | ⚠️ |
| TC-004: Delete | SKIP | SKIP | - |

### Screenshots
- [timestamp]-dark-create.png
- [timestamp]-light-create.png
...

### Issues Found
| ID | Severity | Description | Theme | Screenshot |
|----|----------|-------------|-------|------------|
| 001 | HIGH | Form submit fails | Both | ss_xxx.png |

### Console Errors
[List any JS errors or failed API calls]

### Recommendations
1. [Fix critical issues before deploy]
2. [Nice-to-have improvements]

### Verdict
[ ] READY FOR PRODUCTION
[ ] NEEDS FIXES (see issues)
[ ] BLOCKED (critical failures)
```

## Module-Specific Test Cases

### RFQ Module (`/e2e rfq`)

```
TC-RFQ-001: Create RFQ
  1. Navigate to /procurement/rfq/new
  2. Select project from dropdown
  3. Enter title: "E2E Test RFQ - [timestamp]"
  4. Set response deadline
  5. Add line items via Stock Item Selector
  6. Select suppliers
  7. Click "Save as Draft"
  8. Verify success, note RFQ ID

TC-RFQ-002: View RFQ List
  1. Navigate to /procurement/rfq
  2. Verify test RFQ appears in list
  3. Check status badge displays
  4. Verify item/supplier counts

TC-RFQ-003: View RFQ Detail
  1. Click on test RFQ
  2. Verify all sections load:
     - Header with status
     - Stat cards (Due, Items, Suppliers, Quotes)
     - Items tab with line items
     - Suppliers tab with contacts
  3. Check data matches what was entered

TC-RFQ-004: Edit RFQ
  1. Click "Edit RFQ"
  2. Modify title, add item
  3. Save changes
  4. Verify changes persisted

TC-RFQ-005: Convert to PO
  1. Click "Create Purchase Order"
  2. Select supplier
  3. Fill delivery address
  4. Verify items populated
  5. Click "Create Purchase Order"
  6. Verify PO created (check /procurement/purchase-orders)

TC-RFQ-006: Stock Item Selector
  1. Open Stock Item Selector modal
  2. Search for existing item
  3. Verify search results
  4. Select item → verify added to RFQ
  5. Create new stock item
  6. Verify item created and added

TC-RFQ-007: Supplier Selection
  1. Verify supplier checkboxes load
  2. Select multiple suppliers
  3. Verify selection persists on save
  4. Check supplier details display
```

## Integration with Other Commands

- `/e2e` runs BEFORE `/deploy` to staging
- Results logged to `docs/e2e-reports/`
- Failed E2E blocks production deployment
- Works with `/tdd` for test coverage

## Common Bugs to Check

Based on E2E testing (Jan 2026), always check for:

### Dark Mode Issues
| Issue | Symptom | Check | Fix |
|-------|---------|-------|-----|
| Input contrast | White inputs on dark bg | Inspect input backgrounds | Use `bg-[var(--ff-bg-primary)]` |
| Modal visibility | Modal appears but content invisible | Check modal z-index, backgrounds | Portal to `document.body` |
| Text readability | Text same color as background | Check text color inheritance | Explicit text colors |

### API/Database Issues
| Issue | Symptom | Check | Fix |
|-------|---------|-------|-----|
| Column mismatch | "column X does not exist" | Compare INSERT to schema | Use correct column names |
| NOT NULL violation | "null value violates not-null" | Check required fields in INSERT | Populate all required columns |
| Field name mismatch | Data missing in UI | Compare API response to component props | Match field names exactly |

### Modal/Portal Issues
| Issue | Symptom | Check | Fix |
|-------|---------|-------|-----|
| Modal not appearing | Click button, nothing happens | Parent has `overflow:hidden` | Use `createPortal(modal, document.body)` |
| Dropdown clipped | Options cut off | Parent container constraints | Portal or z-index fix |

### Database Column Reference
When saving to `rfq_items`:
- Use `budget_price` (not `estimated_unit_price`)
- Include `project_id` (NOT NULL constraint)

## Cleanup

After testing, offer to clean up test data:
```
Test data created:
- RFQ: "E2E Test RFQ - 2026-01-19" (ID: xxx)
- Stock Item: "E2E Test Item" (ID: yyy)

Clean up test data? [y/n]
```
