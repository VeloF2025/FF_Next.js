# Accounting Module CHANGELOG

All notable changes to the Accounting module are documented here.

---

## [Unreleased]

### Security
- **JWT Auth Hardening: All Accounting Endpoints** (2026-03-10, commit `ed486bd`)
  - Replaced unsafe userId extraction across 26 endpoints
  - All accounting APIs now use AuthenticatedNextApiRequest
  - Removed type coercions: (req as unknown as { user?: { id: string } }).user?.id
  - Zero unsafe userId patterns remain in accounting module

### Added
- **VAT Code Support in Bank Rules** (2026-03-03, commit `2238bbd5`)
  - VAT code field on bank categorisation rules
  - Default VAT code per GL account
  - Automatic VAT journal line splitting
  - UI controls for VAT selection and inline editing

---

## Commit Details

### ed486bd — fix(security): use AuthenticatedNextApiRequest in remaining 26 accounting endpoints

**Date**: 2026-03-10 12:10:41 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Extends security hardening (from PR #82) across ALL 26 accounting API endpoints. Replaces unsafe userId extraction patterns with secure JWT-based `req.user.id` from AuthenticatedNextApiRequest wrapper. Eliminates all unsafe type coercions and req.body.userId fallbacks.

#### Security Vulnerability Fixed

**Pattern**: Unsafe userId extraction using type coercions and fallbacks
```typescript
// BEFORE (Unsafe):
const userId = (req as unknown as { user?: { id: string } }).user?.id || req.body.userId;

// AFTER (Secure):
const userId = req.user.id;  // From AuthenticatedNextApiRequest
```

**Attack Vector**: 
- Caller could pass `userId` in request body to impersonate another user
- Type coercion bypasses TypeScript compiler checks
- No JWT validation of identity

**Fix**: 
- All endpoints now wrapped with `withAuth()` middleware
- userId extracted from verified JWT token
- Type safety enforced by AuthenticatedNextApiRequest type
- Request body userId values ignored (security boundary)

#### Endpoints Updated (26 total)

All files in `pages/api/accounting/`:

1. **accounting-settings.ts** (8 lines modified)
2. **adjustments-action.ts** (10 lines modified)
3. **adjustments.ts** (9 lines modified)
4. **bank-reconciliations-action.ts** (11 lines modified)
5. **bank-rules-seed.ts** (10 lines modified)
6. **batch-payments-action.ts** (11 lines modified)
7. **batch-payments.ts** (9 lines modified)
8. **credit-notes-action.ts** (12 lines modified)
9. **customer-invoices-create.ts** (8 lines modified)
10. **customer-invoices-gl.ts** (11 lines modified)
11. **customer-payments-action.ts** (12 lines modified)
12. **customer-quotes-action.ts** (8 lines modified)
13. **customer-quotes.ts** (9 lines modified)
14. **journal-entries-action.ts** (11 lines modified)
15. **recurring-invoices-action.ts** (10 lines modified)
16. **recurring-invoices.ts** (9 lines modified)
17. **recurring-journals-action.ts** (10 lines modified)
18. **recurring-journals.ts** (9 lines modified)
19. **run-depreciation.ts** (8 lines modified)
20. **sage-migration-action.ts** (9 lines modified)
21. **supplier-invoices-action.ts** (11 lines modified)
22. **supplier-payments-action.ts** (12 lines modified)
23. **vat-adjustments-action.ts** (10 lines modified)
24. **vat-adjustments.ts** (9 lines modified)
25. **write-offs-action.ts** (10 lines modified)
26. **write-offs.ts** (9 lines modified)

#### Refactoring Pattern Applied

**Before**:
```typescript
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as unknown as { user?: { id: string } }).user?.id || req.body.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  // ... endpoint logic
}
```

**After**:
```typescript
import type { AuthenticatedNextApiRequest } from '@/lib/auth';
import { withAuth } from '@/lib/auth';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const userId = req.user.id;  // Guaranteed by withAuth
  // ... endpoint logic
}

export default withAuth(handler);
```

#### Benefits

1. **Type Safety**:
   - AuthenticatedNextApiRequest enforces `req.user.id` exists
   - TypeScript compiler prevents unsafe access patterns
   - Eliminates runtime type coercion errors

2. **Security**:
   - userId sourced from verified JWT (no caller override)
   - Single security boundary at withAuth middleware
   - Audit logging in middleware captures all access

3. **Code Quality**:
   - Consistent pattern across all endpoints
   - Reduced code duplication (withAuth handles auth)
   - Easier to audit security posture

4. **Maintainability**:
   - Future security updates applied at middleware level
   - No need to modify individual endpoints
   - Cleaner endpoint handler signatures

#### Code Changes Summary

- **Total Lines**: 111 insertions, 144 deletions (net -33 lines)
- **Pattern**: Consistent auth wrapper + userId extraction
- **Regressions**: None (all endpoints maintain existing API contracts)
- **Testing**: All endpoints tested with JWT token validation

#### Testing Checklist

- [x] All 26 endpoints require valid JWT token (withAuth enforced)
- [x] Calls without Authorization header receive 401
- [x] Calls with invalid JWT receive 401
- [x] Calls with valid JWT work as before
- [x] Request body userId is ignored (cannot impersonate)
- [x] User ID is correctly extracted from JWT payload
- [x] All endpoint APIs unchanged (backward compatible)
- [x] No TypeScript errors after refactoring

#### PRD Alignment

**Status**: Security hardening per internal security audit (not client-facing feature).

**Related**: PR #82 (initial auth hardening in accounting module)

**Notes**:
- Completes security audit for entire accounting module
- No functional changes to existing APIs
- Zero unsafe patterns remain in accounting
- Improves compliance posture for financial transaction handling

---

### 2238bbd5 — feat(accounting): add VAT code to bank rules + default VAT per GL account

**Date**: 2026-03-03 07:59:06 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Sonnet 4.6

#### Description

Adds comprehensive VAT support to bank categorization rules and GL accounts, enabling automatic VAT journal line creation during transaction processing.

#### Database Changes

1. **bank_categorisation_rules table**:
   - New column: `vat_code` (text, default 'none')
   - Values: 'none', 'standard', 'zero_rated', 'exempt'
   - Stores VAT classification for rule matching
   - Nullable for backward compatibility

2. **gl_accounts table**:
   - New column: `default_vat_code` (text, default 'none')
   - Values: 'none', 'standard', 'zero_rated', 'exempt'
   - Default VAT for new rules using this account
   - Indexed for query performance

#### Files Changed

1. **pages/accounting/bank-reconciliation/rules.tsx** (+52 lines)
   - Added VAT_LABELS constant: { none, standard, zero_rated, exempt }
   - Updated Rule interface: Added vatCode field
   - Updated GLAccount interface: Added defaultVatCode field
   - Form state: `form.vatCode` (default 'none')
   - Account loading: Maps `defaultVatCode` from API
   - Reset form: Sets vatCode to 'none'
   - Edit rule: Pre-fills existing vatCode
   - Form submission: Includes vatCode in request
   - Rules table: Added VAT column display

2. **pages/accounting/index.tsx** (+402 lines)
   - Added VAT_CODES constant and LABEL mapping
   - Chart of Accounts table: New "VAT Default" column
   - Inline edit mode for each account:
     - Click edit icon → dropdown VAT selector
     - onChange: Updates GL account's defaultVatCode
     - POST to `/api/accounting/chart-of-accounts/:id`
   - Visual indicator for current VAT default
   - Error handling for inline edit failures
   - UI enhancements:
     - Better spacing, icons, tooltips
     - Responsive column layout
     - Batch operations for bulk VAT updates

3. **pages/api/accounting/bank-rules.ts** (+3 lines)
   - Response includes vatCode in rule object
   - Validation: vatCode must be from allowed set
   - Error: Returns 400 if invalid vatCode

4. **pages/api/accounting/chart-of-accounts.ts** (+11 lines)
   - Response includes defaultVatCode per account
   - Patch/update endpoint accepts defaultVatCode
   - Validation: Must be from allowed set
   - Error handling: 400 for invalid codes

5. **src/components/accounting/CreateRuleModal.tsx** (+32 lines)
   - Added VAT code picker (button group or dropdown)
   - VAT options: No VAT, Standard 15%, Zero Rated, Exempt
   - Auto-fill logic:
     - When GL account selected → fills from account's defaultVatCode
     - Allow override (VAT picker is independent)
   - Form validation: Ensures vatCode is set
   - Submit: Includes vatCode in payload

6. **src/modules/accounting/services/bankRulesService.ts** (+62 lines)
   - Updated `applyRules()` function:
     - Looks up VAT code from rule (or defaults to account's VAT)
     - Creates main GL journal line (as before)
     - If VAT code != 'none': Creates VAT journal line
       - Account: 2100 (VAT Payable)
       - Amount: 15% of transaction (for 'standard')
       - Amount: 0 (for 'zero_rated')
       - Amount: 0 (for 'exempt')
     - VAT line includes tax code tracking
   - Transactional: Both lines created as atomic unit
   - Error handling: Logs VAT split failures
   - Backward compat: Existing rules without VAT → treated as 'none'

#### Key Changes

- **VAT Classification**:
  - Rules now carry VAT intent (code)
  - GL accounts have VAT defaults
  - Bank transactions auto-split on VAT when rules match
  
- **Auto-Create Logic**:
  - When rule matches: Check rule.vatCode
  - Create main GL line with full amount
  - Create VAT line (if applicable):
    - `applyRules()` mirrors existing `allocateTransaction()` VAT logic
    - VAT % calculated based on code
    - Separate GL entry created for VAT
  
- **User Experience**:
  - Rules table shows VAT column (sorted, filterable)
  - GL account form shows VAT default inline
  - CreateRuleModal auto-fills VAT from selected account
  - Override capable: Can pick different VAT than account default
  
- **Compliance**:
  - All VAT lines tracked with source rule
  - Audit trail: Log which rules created VAT splits
  - Reconciliation: VAT GL balance should match sum of splits
  - Export: Include VAT code in transaction export

#### VAT Journal Entry Examples

**Example 1: Supplier Invoice (Standard 15% VAT)**
```
Input: Bank transaction $1,150 matches rule with GLAccount#4100 (Sales) + VAT='standard'

GL Entry:
  Line 1: 4100 (Sales)        Debit  $1,000.00  (tax_code: none)
  Line 2: 2100 (VAT Payable)   Credit   $150.00  (tax_code: standard_input)
  
Total: Balanced $1,000 revenue + $150 VAT in
```

**Example 2: Zero-Rated Service (Export)**
```
Input: Bank transaction $5,000 matches rule with GLAccount#4200 (Exports) + VAT='zero_rated'

GL Entry:
  Line 1: 4200 (Exports)       Debit  $5,000.00  (tax_code: none)
  Line 2: 2100 (VAT Payable)   Credit      $0.00  (tax_code: zero_rated)
  
Total: Balanced $5,000 revenue, $0 VAT
```

**Example 3: Exempt (Insurance)**
```
Input: Bank transaction $500 matches rule with GLAccount#4300 (Insurance) + VAT='exempt'

GL Entry:
  Line 1: 4300 (Insurance)     Debit     $500.00  (tax_code: none)
  
Note: NO VAT line created for exempt transactions
```

#### API Usage Examples

```bash
# Create rule with VAT code
POST /api/accounting/bank-rules
Body: {
  "ruleName": "Supplier Invoice",
  "glAccountId": "123",
  "vatCode": "standard"
}

# Update rule VAT
PUT /api/accounting/bank-rules/456
Body: {
  "vatCode": "zero_rated"
}

# Set account default VAT
PATCH /api/accounting/chart-of-accounts/789
Body: {
  "defaultVatCode": "standard"
}
```

#### Testing Checklist

- [ ] Create rule with VAT='standard' → Auto-create splits 15% VAT
- [ ] Create rule with VAT='zero_rated' → No VAT amount (line exists with $0)
- [ ] Create rule with VAT='exempt' → No VAT line at all
- [ ] Create rule with VAT='none' → No VAT splitting
- [ ] Select account with default VAT → Form auto-fills
- [ ] Override account VAT in form → Works as selected
- [ ] Change account default VAT → Existing rules unchanged
- [ ] Existing transactions still reconcile with new VAT logic
- [ ] Inline edit CoA VAT → Saves correctly
- [ ] Bulk update account VAT defaults → All updated
- [ ] Export transactions → Includes VAT code column
- [ ] Compliance report → Shows VAT splits by code

#### Notes

- **Backward Compatibility**: Existing rules without vatCode treated as 'none'
- **Migration**: No data migration needed (default 'none' maintains existing behavior)
- **Performance**: VAT code lookup indexed, no query slowdown
- **Audit**: Log each VAT split with rule ID + amount for compliance
- **Future**: Add VAT return generation, period closing lock, VAT GL reconciliation

---

**Module Owner**: velo:velo  
**Last Updated**: 2026-03-10  
**Changelog Version**: 1.0
