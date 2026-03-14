# Accounting Module Documentation

**Module**: Accounting & Bank Reconciliation
**Status**: Active Development
**Last Updated**: 2026-03-10

---

## 🎯 Module Overview

The Accounting module handles financial tracking and bank reconciliation, including:

- **Bank Reconciliation**: Match bank statements to internal transactions
- **Bank Categorisation Rules**: Auto-categorize transactions by pattern matching
- **Chart of Accounts**: GL account master data with VAT defaults
- **VAT Handling**: Track and split VAT across journal lines
- **Transaction Processing**: Allocate bank transactions to GL accounts
- **Reporting**: Bank spend summaries and reconciliation status

---

## 📊 Key Features

### VAT Code Support in Bank Rules (PRIORITY: High)
**Commit**: `2238bbd5` (2026-03-03)

Comprehensive VAT handling across bank categorization rules and GL accounts:

#### Database Changes
- **bank_categorisation_rules.vat_code**: Default 'none'
  - Values: 'none', 'standard' (15%), 'zero_rated', 'exempt'
  - Applied when rule matches a transaction
  
- **gl_accounts.default_vat_code**: Default 'none'
  - VAT code per GL account
  - Auto-fills when account is selected in rule form
  - Used in journal entry splitting

#### Rule-Level VAT
- VAT code stored on rules (not just GL account)
- `applyRules` auto-create path now splits VAT:
  - Mirrors existing `allocateTransaction` logic
  - Creates separate VAT journal line
  - Calculates VAT amount (15% of base)
  
- Rules table shows VAT column
- CreateRuleModal has button-group VAT picker
- Selecting GL account auto-fills VAT from account default

#### Chart of Accounts Updates
- New `defaultVatCode` field on GLAccount type
- API updated to expose default VAT per account
- Inline edit allows VAT dropdown per account
- "VAT Default" column in CoA table
- Visual indicator for zero-rated vs standard vs exempt

---

## 🏗️ Architecture

### Database
- **bank_categorisation_rules**:
  - New column: `vat_code` (text, default 'none')
  - Foreign key: Implicitly links to account defaults
  
- **gl_accounts**:
  - New column: `default_vat_code` (text, default 'none')
  - Indexed for fast lookup
  - Used in rule creation forms

### Services
- **bankRulesService.ts** (updated)
  - `applyRules()` now handles VAT splitting
  - Uses vat_code from rule OR account default
  - Creates GL entries with VAT journal lines
  - Transactional: All-or-nothing journal creation
  
- **chartOfAccountsService.ts** (updated)
  - Handles default_vat_code field
  - Exposes VAT in CoA API

### Components
- **BankRulesPage** (updated)
  - VAT column in rules table
  - VAT code tracked in form state
  - Button group for VAT selection
  
- **CreateRuleModal** (updated)
  - VAT picker (radio buttons or dropdown)
  - Auto-fills from selected GL account
  - Validates VAT value before submit
  
- **ChartOfAccounts** (updated in `pages/accounting/index.tsx`)
  - Inline edit for default_vat_code
  - VAT Default column (402 lines modified, +402 lines)
  - Dropdown selector for VAT options

### API Endpoints
- `GET /api/accounting/bank-rules` - Fetch rules with VAT codes
- `POST /api/accounting/bank-rules` - Create rule with VAT
- `PUT /api/accounting/bank-rules/:id` - Update rule VAT
- `GET /api/accounting/chart-of-accounts` - Fetch accounts with VAT defaults
- `PATCH /api/accounting/chart-of-accounts/:id` - Update account VAT default

---

## 🔧 Main Files

| File | Purpose | Lines |
|------|---------|-------|
| `pages/accounting/bank-reconciliation/rules.tsx` | Rules UI | +52 |
| `pages/accounting/index.tsx` | Chart of Accounts UI | +402 |
| `pages/api/accounting/bank-rules.ts` | Rules API | +3 |
| `pages/api/accounting/chart-of-accounts.ts` | CoA API | +11 |
| `src/components/accounting/CreateRuleModal.tsx` | Rule creation | +32 |
| `src/modules/accounting/services/bankRulesService.ts` | Rules logic | +62 |

---

## 🚀 Workflows

### Create Bank Rule with VAT

1. Click "New Rule" in Bank Reconciliation Rules
2. Fill basic fields:
   - Rule Name (e.g., "Supplier Invoice")
   - Match Field (description, amount, etc.)
   - Match Pattern
3. Select GL Account
   - If account has default VAT → auto-filled
   - Can override with different VAT
4. Pick VAT Code:
   - Button group: No VAT / 15% / Zero Rated / Exempt
5. Save rule
6. When rule matches: VAT split applied automatically

### Set Account VAT Default

1. Go to Chart of Accounts
2. Find GL account (e.g., 4000 - Revenue)
3. Click inline edit (pencil icon)
4. Select VAT Default:
   - No VAT
   - 15% (Standard)
   - Zero Rated
   - Exempt
5. Save
6. New rules using this account will auto-fill this VAT

### Auto-Create GL Entry with VAT

When bank rule matches and auto-creates entry:
1. Look up VAT code from rule
2. Create main GL line:
   - Account: From rule
   - Amount: Full transaction amount
3. Create VAT journal line (if VAT code != 'none'):
   - Account: 2100 (VAT Payable)
   - Amount: 15% of main amount (calculated)
   - Tax Code: From rule
4. Both lines in same journal entry (transactional)

---

## 📝 Important Notes

### VAT Calculation
- **Standard (15%)**: VAT = Base × 0.15
- **Zero Rated**: VAT line created but amount = 0
- **Exempt**: No VAT line created
- **None**: No VAT handling

### Compliance
- All VAT lines have tax code tracked
- Audit trail: Log VAT splits for compliance
- Reconciliation: Verify VAT total matches GL account balance
- Period closing: Lock VAT entries once period is closed

### Testing
- [ ] Create rule with VAT code 'standard'
- [ ] Auto-create entry shows 2 GL lines (base + VAT)
- [ ] VAT amount = 15% of base
- [ ] Change account default VAT → next rule auto-fills
- [ ] Override account default in rule form works
- [ ] Zero-rated entry creates VAT line with amount=0
- [ ] Exempt entry has NO VAT line
- [ ] All transactions reconcile to GL

### Performance
- VAT code lookup on rule apply: Indexed column (fast)
- Journal entry creation: Transactional (all-or-nothing)
- CoA updates: Bulk edit of VAT defaults (batch operation)

---

## 📚 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Commit history
- **[Projects Module](../projects/README.md)** — Project accounting
- **[Pipeline Module](../pipeline/README.md)** — Deal accounting

---

**Owner**: velo:velo
**Last Updated**: 2026-03-10
