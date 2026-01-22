# Procurement Module Audit

Module-specific audit for the FibreFlow Procurement module. Run this after `/audit` global checks.

**Parent:** `/audit` - Run global audit first for infrastructure, code quality, and UI standards.

## Audit Areas

### 1. Dark Theme Compliance
Check all procurement pages for proper dark theme CSS variables:

**Required Variables:**
- Background: `var(--ff-bg-secondary)`, `var(--ff-bg-tertiary)`
- Text: `var(--ff-text-primary)`, `var(--ff-text-secondary)`, `var(--ff-text-tertiary)`
- Borders: `var(--ff-border-light)`
- Colors with opacity: `bg-blue-500/20`, `text-blue-400` (not `bg-blue-100`, `text-blue-600`)

**Forbidden Patterns (Light Theme):**
- `bg-white`, `bg-gray-50`, `bg-gray-100`
- `text-gray-900`, `text-gray-700`, `text-gray-600`
- `border-gray-200`, `border-gray-300`

**Pages to Check:**
- `/procurement` - Dashboard
- `/procurement/inventory` - Stock, Items, Categories, Bundles, Takes, Field, Reports tabs
- `/procurement/sourcing` - RFQ, BOQ pages
- `/procurement/purchasing` - PO pages
- `/procurement/approvals` - Approval workflows
- `/procurement/financial` - Financial reports

### 2. Currency Formatting
All monetary values must follow South African Rand format:

**SA Format Rules:**
- Prefix: `R` followed by space
- Thousands separator: Space (` `)
- Decimal separator: Comma (`,`)
- Examples: `R 695 775`, `R 194 287,50`, `R 1 780 800`

**Alternative (Items/Bundles):**
- Some components use period decimals: `R29.36`, `R433.30`
- This is acceptable but should be consistent within same view

**Check Locations:**
- [x] Bundle totals and item prices - Uses `R29.36` format
- [x] Stock item costs - Uses `R29.36` format
- [ ] RFQ/BOQ line items and totals
- [x] Purchase order amounts - Uses `R 695 775` format (SA style)
- [x] Dashboard summary cards

### 3. Number Formatting
Large numbers should use thousands separators:

**Stock Items Tab:**
- Separator: Comma (`,`)
- Examples: `8,586`, `16,000`, `380,000`

**Purchase Orders/Requisitions:**
- Separator: Space (` `) - SA style
- Examples: `R 1 780 800`, `R 695 775`

**Check Locations:**
- [ ] Stock quantities
- [ ] Item counts
- [ ] Dashboard metrics

### 4. Calculations Verification

**Bundle Calculations:**
```
Line Total = Quantity × Unit Price
Bundle Total = Sum of all Line Totals
```

**Stock Metrics:**
```
Total Value = Sum(Quantity × Unit Price) for all items
Critical Stock = Low Stock Items + Out of Stock Items
```

### 5. Toast Notifications
Verify all CRUD operations show proper notifications:

**Expected Patterns:**
- Success: Green toast with checkmark
- Error: Red toast with error message
- Info: Blue toast for information

**Operations to Test:**
- [ ] Create bundle → Success toast
- [ ] Update item → Success toast
- [ ] Delete with error → Error toast
- [ ] Sync operation → Progress then result toast

### 6. Status Badges
Verify correct colors for status indicators:

| Status | Background | Text |
|--------|------------|------|
| Active/In Stock | `bg-green-500/20` | `text-green-400` |
| Pending | `bg-yellow-500/20` | `text-yellow-400` |
| Out of Stock | `bg-red-500/20` | `text-red-400` |
| Draft | `bg-gray-500/20` | `text-gray-400` |

### 7. Table/Grid Consistency
All data tables should have:
- [ ] Proper column headers with uppercase styling
- [ ] Alternating row hover states
- [ ] Consistent padding and alignment
- [ ] Responsive scroll on mobile

## Automated Checks

Run grep to find light theme violations:
```bash
grep -rn "bg-white\|bg-gray-50\|bg-gray-100\|text-gray-900\|border-gray-200" \
  src/modules/procurement/ \
  src/components/procurement/ \
  pages/procurement/
```

## Manual Testing Checklist

### Bundles Tab
- [ ] Total Value calculation matches sum of bundles
- [ ] Bundle item calculations correct (qty × unit price)
- [ ] Manage Items modal opens and shows details
- [ ] Add/remove items updates total

### Items Tab
- [ ] Cost column shows R prefix with 2 decimals
- [ ] Available column shows thousands separator
- [ ] Status badges use correct colors
- [ ] Filter and search work correctly

### BOQ Tab
- [ ] BOQ list shows proper status colors
- [ ] Item counts are accurate
- [ ] Upload and mapping workflow complete

### RFQ Tab
- [ ] Date formats consistent (DD/MM/YYYY or relative)
- [ ] Status transitions work correctly
- [ ] Line item calculations accurate

### Reports Tab
- [ ] Date range filters work
- [ ] Export generates correct data
- [ ] Charts render with dark theme colors

## Issue Tracking

When issues are found, document:
1. Page/component location
2. Screenshot or description
3. Expected vs actual behavior
4. File path and line number if known

## Last Audit Results

| Date | Auditor | Issues Found | Fixed |
|------|---------|--------------|-------|
| 2026-01-22 | Claude | StockManagement.tsx dark theme | ✓ |
| 2026-01-22 | Claude | Bundle calculations verified | ✓ |
| 2026-01-22 | Claude | Currency/number formats verified | ✓ |
| 2026-01-22 | Claude | Purchase Orders - SA format verified | ✓ |
| 2026-01-22 | Claude | Stock Items - comma thousands separator | ✓ |
| 2026-01-22 | Claude | Status badges - green for Approved | ✓ |
| 2026-01-22 | Claude | BOQ detail - items/value from actual array | ✓ |
| 2026-01-22 | Claude | Reports tab - date filters working | ✓ |
| 2026-01-22 | Claude | Suppliers - list, filters, status badges | ✓ |
| 2026-01-22 | Claude | Bundles modal - items, calculations, save | ✓ |
| 2026-01-22 | Claude | Toast notifications via NotificationService | ✓ |
