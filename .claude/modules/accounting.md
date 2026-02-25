# Accounting Module

PRD-060 | Native double-entry accounting engine replacing Sage

## Architecture

```
src/modules/accounting/
├── types/
│   ├── gl.types.ts        # GL accounts, journal entries, fiscal periods, reports
│   ├── ap.types.ts        # Supplier invoices, payments, AP aging
│   ├── ar.types.ts        # Customer payments, credit notes
│   └── bank.types.ts      # Bank transactions, reconciliations, auto-match
├── services/
│   ├── chartOfAccountsService.ts     # CRUD, tree hierarchy, seed SA chart
│   ├── journalEntryService.ts        # Create/post/reverse, trial balance
│   ├── fiscalPeriodService.ts        # Open/close/lock periods
│   ├── supplierInvoiceService.ts     # AP invoices, 3-way match, approval
│   ├── supplierPaymentService.ts     # Payment runs, batch processing
│   ├── apAgingService.ts             # Current/30/60/90/120+ buckets
│   ├── customerPaymentService.ts     # Payment allocation, GL auto-post
│   ├── arAgingService.ts             # AR aging report
│   ├── creditNoteService.ts          # Customer + supplier credit notes
│   ├── bankReconciliationService.ts  # Import, match, reconcile
│   ├── financialReportingService.ts  # P&L, balance sheet, VAT, profitability
│   ├── glIntegrationHooks.ts         # Auto-post from procurement/invoicing
│   ├── sageMigrationService.ts       # Sage → GL migration orchestrator
│   └── sageImportService.ts          # Ledger + invoice importers
└── utils/
    ├── doubleEntry.ts        # DR/CR validation engine
    ├── threeWayMatch.ts      # PO vs GRN vs Invoice matching
    ├── paymentAllocation.ts  # Multi-invoice payment allocation
    ├── aging.ts              # Aging bucket calculation
    ├── autoMatch.ts          # Bank tx ↔ GL line matching
    └── bankCsvParsers.ts     # FNB, Standard Bank, Nedbank CSV parsers
```

## Key Concepts

### Double-Entry Engine
Every transaction creates a balanced journal entry (total debit = total credit).
DB trigger `check_journal_balance` enforces this on `gl_journal_entries`.

### Account Types & Normal Balances
| Type | Normal Balance | Codes |
|------|---------------|-------|
| Asset | Debit | 1xxx |
| Liability | Credit | 2xxx |
| Equity | Credit | 3xxx |
| Revenue | Credit | 4xxx |
| Expense | Debit | 5xxx |

### GL Integration Hooks (`glIntegrationHooks.ts`)
These fire automatically when existing modules trigger financial events:
- **Customer Invoice Approved** → DR AR (1120), CR Revenue (4100), CR VAT Output (2120)
- **Customer Payment Recorded** → DR Bank (1110), CR AR (1120)
- **GRN Confirmed** → DR Materials (5100), CR AP (2110)

All hooks are non-blocking — the parent action succeeds even if GL posting fails.

## Database

### Migrations (200-205)
| Migration | Tables |
|-----------|--------|
| 200 | `gl_accounts`, `gl_journal_entries`, `gl_journal_lines`, `gl_fiscal_periods` |
| 201 | `supplier_invoices`, `supplier_invoice_items`, `supplier_payments`, `supplier_payment_allocations` |
| 202 | `customer_payments`, `customer_payment_allocations`, `credit_notes` |
| 203 | `bank_transactions`, `bank_reconciliations` |
| 204 | Account subtype classification (UPDATE only) |
| 205 | `gl_migration_runs`, `gl_migration_comparisons` + link columns on sage tables |

### Seeded Chart of Accounts
32 accounts with 3-level hierarchy. Level 3 accounts are posting accounts.
Level 1/2 are grouping headers (Assets → Current Assets → Bank).

## API Routes (29 total)

### General Ledger
- `GET/POST /api/accounting/chart-of-accounts`
- `GET /api/accounting/chart-of-accounts-detail?id=`
- `GET/POST /api/accounting/journal-entries`
- `GET /api/accounting/journal-entries-detail?id=`
- `POST /api/accounting/journal-entries-action` (post, reverse)
- `GET/POST /api/accounting/fiscal-periods`
- `POST /api/accounting/fiscal-periods-action` (close, lock)

### Accounts Payable
- `GET/POST /api/accounting/supplier-invoices`
- `GET /api/accounting/supplier-invoices-detail?id=`
- `POST /api/accounting/supplier-invoices-action` (approve, match)
- `GET/POST /api/accounting/supplier-payments`
- `POST /api/accounting/supplier-payments-action` (approve, process)
- `GET /api/accounting/ap-aging`

### Accounts Receivable
- `GET/POST /api/accounting/customer-payments`
- `POST /api/accounting/customer-payments-action` (confirm)
- `GET /api/accounting/ar-aging`
- `GET/POST /api/accounting/credit-notes`
- `POST /api/accounting/credit-notes-action` (approve)
- `POST /api/accounting/customer-invoices-gl` (post existing invoice)

### Bank Reconciliation
- `GET /api/accounting/bank-transactions`
- `POST /api/accounting/bank-transactions-import` (CSV upload)
- `POST /api/accounting/bank-transactions-action` (match, unmatch, exclude, auto_match)
- `GET/POST /api/accounting/bank-reconciliations`
- `POST /api/accounting/bank-reconciliations-action` (complete, adjustment)

### Reports
- `GET /api/accounting/reports-trial-balance`
- `GET /api/accounting/reports-income-statement`
- `GET /api/accounting/reports-balance-sheet`
- `GET /api/accounting/reports-vat-return`
- `GET /api/accounting/reports-project-profitability`

### Migration
- `GET /api/accounting/sage-migration`
- `POST /api/accounting/sage-migration-action`

## UI Pages (22)

| Path | Description |
|------|-------------|
| `/accounting` | Overview dashboard with tabbed interface |
| `/accounting?tab=chart-of-accounts` | Account tree with CRUD |
| `/accounting?tab=journal-entries` | Entry list with drill-down |
| `/accounting?tab=fiscal-periods` | Period management |
| `/accounting?tab=reports` | Report navigation hub |
| `/accounting/journal-entries/new` | Manual journal entry form |
| `/accounting/journal-entries/[entryId]` | Entry detail with lines |
| `/accounting/supplier-invoices` | AP invoice list |
| `/accounting/supplier-invoices/new` | Capture invoice with 3-way match |
| `/accounting/supplier-invoices/[invoiceId]` | Invoice detail |
| `/accounting/supplier-payments` | Payment list |
| `/accounting/supplier-payments/new` | Payment with multi-invoice allocation |
| `/accounting/ap-aging` | Aging buckets with drill-down |
| `/accounting/customer-payments` | Customer payment list |
| `/accounting/customer-payments/new` | Payment with invoice allocation |
| `/accounting/ar-aging` | AR aging report |
| `/accounting/credit-notes` | Credit note list |
| `/accounting/credit-notes/new` | Create customer or supplier CN |
| `/accounting/bank-reconciliation` | Recon session list |
| `/accounting/bank-reconciliation/import` | CSV file upload |
| `/accounting/bank-reconciliation/new` | Start reconciliation |
| `/accounting/bank-reconciliation/[reconId]` | Matching workspace |
| `/accounting/reports/*` | 4 dedicated report pages |
| `/accounting/sage-migration` | Migration dashboard |

## Testing
60 unit tests across 5 test files:
- `double-entry.test.ts` — DR/CR validation
- `three-way-match.test.ts` — PO/GRN/Invoice matching
- `payments.test.ts` — Payment allocation
- `aging.test.ts` — Aging bucket calculation
- `bank-csv-parsers.test.ts` — FNB/StdBank/Nedbank CSV parsing

## Common Patterns

### Neon SQL — NO conditional fragments
```typescript
// WRONG — breaks Neon tagged template parser
${cond ? sql`AND x` : sql``}

// RIGHT — explicit query branches
if (cond) { rows = await sql`... AND x ...`; }
else { rows = await sql`... ...`; }
```

### API wrapper order
```typescript
export default withAuth(withErrorHandler(handler));
```

### Numeric values from Neon
Always `Number()` before arithmetic — Neon returns decimal as string.
