# RFQ Module E2E Test Log - January 2026

## Test Date: January 18-19, 2026
## Environment: Production Build (localhost:3005)
## Tested By: Claude Code E2E Automation

---

## Summary

Complete E2E testing of RFQ creation workflow in both Dark Mode and Light Mode. All critical bugs identified and fixed.

**Result: PASS** - RFQ module ready for production.

---

## Bugs Found & Fixed

### 1. Stock Item Selector Modal Not Rendering
- **Symptom:** Modal didn't appear when clicking "Add from Stock"
- **Root Cause:** Modal rendered inside overflow:hidden container
- **Fix:** Used React `createPortal` to render modal at document.body level
- **File:** `src/components/procurement/StockItemSelector.tsx:182-195`
- **Status:** FIXED

### 2. Supplier Names Not Displaying
- **Symptom:** Suppliers showed blank names in checkbox list
- **Root Cause:** Field name mismatch - API returns `company_name`, component expected `name`
- **Fix:** Updated component to use `company_name` field
- **File:** `pages/procurement/rfq/new.tsx` (supplier mapping)
- **Status:** FIXED

### 3. Line Items Dark Mode Styling
- **Symptom:** Input fields had inverted contrast (dark text on dark bg)
- **Root Cause:** Default white backgrounds not overridden for dark theme
- **Fix:** Added `bg-[var(--ff-bg-primary)]` to input fields
- **File:** `pages/procurement/rfq/new.tsx` (line item inputs)
- **Status:** FIXED

### 4. RFQ Save Fails - estimated_unit_price Column
- **Symptom:** 500 error on save with "column estimated_unit_price does not exist"
- **Root Cause:** Database column named `budget_price`, not `estimated_unit_price`
- **Fix:** Changed column name in INSERT statement
- **File:** `pages/api/procurement/rfq/index.ts:257`
- **Status:** FIXED

### 5. RFQ Save Fails - project_id NOT NULL Constraint
- **Symptom:** 500 error: "null value in column project_id violates not-null constraint"
- **Root Cause:** `rfq_items` INSERT missing `project_id` column
- **Fix:** Added `project_id` to INSERT with value from parent RFQ record
- **File:** `pages/api/procurement/rfq/index.ts:249-262`
- **Code Change:**
  ```typescript
  // Added project_id to INSERT
  const rfqProjectId = insertedRFQs[0].project_id;
  await sql`
    INSERT INTO rfq_items (
      rfq_id, project_id, line_number, description, quantity, uom,
      specifications, budget_price, stock_item_id, boq_item_id
    ) VALUES (
      ${rfqId}, ${rfqProjectId}, ${i + 1}, ...
    )
  `;
  ```
- **Status:** FIXED

---

## Test Verification

### Dark Mode Testing
- [x] Navigate to RFQ creation page
- [x] Select project from dropdown
- [x] Add line item manually
- [x] Verify input field styling (proper contrast)
- [x] View supplier list (names displaying)
- [x] Save RFQ as draft
- [x] Verify redirect to RFQ list
- [x] Check console for errors (none found)

### Light Mode Testing
- [x] Switch to light mode
- [x] Navigate to RFQ creation page
- [x] Add line item
- [x] Verify form styling (proper backgrounds)
- [x] Check console for errors (none found)

---

## Console Errors

**Dark Mode:** None
**Light Mode:** None

---

## Database Verification

Successfully created test RFQs:
1. "E2E Test RFQ - Project ID Fix Verification" (Dark Mode)

---

## Files Modified

| File | Changes |
|------|---------|
| `src/components/procurement/StockItemSelector.tsx` | Portal rendering |
| `pages/procurement/rfq/new.tsx` | Dark mode styling, supplier field names |
| `pages/api/procurement/rfq/index.ts` | Added project_id to rfq_items INSERT |

---

## Recommendations

1. **Database Schema Review:** Consider adding default values or making `project_id` inherit from parent RFQ to prevent future issues

2. **Type Safety:** Add stricter TypeScript types for database INSERT operations to catch column mismatches at compile time

3. **E2E Test Suite:** Consider adding automated Playwright tests for RFQ workflow to catch regressions

---

## Sign-off

E2E testing complete. RFQ module verified in both dark and light modes with all critical bugs fixed. Ready for production deployment.
