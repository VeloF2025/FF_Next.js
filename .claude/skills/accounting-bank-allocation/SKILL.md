---
name: accounting-bank-allocation
description: Bank transaction allocation workflow for FibreFlow accounting. Statement import, categorisation rules, GL journal entries, suggestion flow. USE WHEN working on bank transactions, allocation rules, or GL journal entries.
user-invocable: false
---

# Bank Transaction Allocation Workflow

## Data Hierarchy
1. **Bank statements** = source of truth (raw imported transactions)
2. **Worksheets** = classifications (categories, GL codes, cost centres)
3. **Smartsheets / Sage** = fallback if needed

## Suggestion Flow
1. Transactions are imported via CSV/PDF/OFX → status = `imported`
2. Categorisation rules run → populate `suggested_gl_account_id`, `suggested_category` (status stays `imported`)
3. UI pre-fills the GL account dropdown from suggestions
4. User clicks Accept → creates GL journal entry → status = `matched`
5. User can override the suggestion before accepting

## Importing Classified Transactions
```bash
# From spreadsheet JSON export:
npx ts-node scripts/import-classified-bank.ts classified-txns.json <bank-account-id>
```
API: `POST /api/accounting/bank-transactions-import-classified`

## Seeding Categorisation Rules
```bash
# From Category Map JSON:
npx ts-node scripts/seed-bank-rules.ts category-map.json
```
API: `POST /api/accounting/bank-rules-seed`

Category Map format:
```json
[{ "originalCategory": "sage accounting", "standardCategory": "Accounting Fees", "glCode": 5680 }]
```

## Apply Rules to Existing Transactions
- UI: Click "Apply Rules" button on bank transactions page
- API: `POST /api/accounting/bank-rules-action` with `{ action: 'apply', bankAccountId }`
- Rules with `auto_create_entry=false` populate suggestions only
- Rules with `auto_create_entry=true` create GL entries and set status='matched'

## Verification Checklist
1. Run migration 223 → suggestion columns added
2. Seed rules from Category Map → verify rules in `bank_categorisation_rules`
3. Apply rules → verify `suggested_gl_account_id` populated on transactions
4. UI shows amber indicator on suggested rows
5. Accept → GL entry created, status='matched'
6. Override → user's choice used, not the suggestion

## Key Files
- Migration: `scripts/migrations/223_bank_tx_suggestions.sql`
- Types: `src/modules/accounting/types/bank.types.ts`
- Rules service: `src/modules/accounting/services/bankRulesService.ts`
- Recon service: `src/modules/accounting/services/bankReconciliationService.ts`
- Seed API: `pages/api/accounting/bank-rules-seed.ts`
- Classified import API: `pages/api/accounting/bank-transactions-import-classified.ts`
- UI table: `src/components/accounting/BankTxTable.tsx`
- UI page: `pages/accounting/bank-transactions/index.tsx`
