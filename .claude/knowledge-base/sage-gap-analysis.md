# Sage → FibreFlow Accounting: Gap Analysis & Implementation Plan
> Date: 2026-02-25

---

## CURRENT FF ACCOUNTING SIDEBAR vs SAGE NAVIGATION

### FF Accounting Sidebar (Current)
```
Accounting
├── Dashboard                    (/accounting)
├── Customers (AR)
│   ├── Tax Invoices             (/accounting/customer-invoices)
│   ├── Receipts                 (/accounting/customer-payments)
│   ├── Credit Notes             (/accounting/credit-notes)
│   ├── Aging                    (/accounting/ar-aging)
│   └── Statements               (/accounting/customer-statements)
├── Suppliers (AP)
│   ├── Invoices                 (/accounting/supplier-invoices)
│   ├── Payments                 (/accounting/supplier-payments)
│   ├── Returns                  (/accounting/supplier-returns)
│   └── Aging                    (/accounting/ap-aging)
├── Banking
│   ├── Bank Accounts            (/accounting/bank-accounts)
│   ├── Import Statement         (/accounting/bank-reconciliation/import)
│   ├── Reconcile                (/accounting/bank-reconciliation)
│   └── Transfers                (/accounting/bank-transfers)
├── General Ledger
│   ├── Chart of Accounts        (/accounting/chart-of-accounts)
│   ├── Journal Entries          (/accounting/journal-entries)
│   ├── Fiscal Periods           (/accounting/fiscal-periods)
│   └── Default Accounts         (/accounting/default-accounts)
├── Accountant
│   ├── Trial Balance            (/accounting/trial-balance)
│   ├── Opening Balances         (/accounting/opening-balances)
│   └── Year-End                 (/accounting/year-end)
├── Reports
│   ├── Income Statement         (/accounting/reports/income-statement)
│   ├── Balance Sheet            (/accounting/reports/balance-sheet)
│   ├── Cash Flow                (/accounting/reports/cash-flow)
│   ├── VAT Return               (/accounting/reports/vat-return)
│   ├── Budget vs Actual         (/accounting/reports/budget-vs-actual)
│   └── Project Profitability    (/accounting/reports/project-profitability)
└── Sage Migration               (/accounting/sage-migration)
```

### Sage Navigation (Reference)
```
Sage Accounting
├── Home (Dashboard, Customer/Supplier/Item/Financial Dashboards, My Workspace)
├── Quick View (Customers, Suppliers, Items, Bank Accounts, Accounts)
├── Customers
│   ├── Add a Customer
│   ├── Lists (Customers, Sales Reps, Customer Categories)
│   ├── Transactions (Quotes, Sales Orders, Tax Invoices, Recurring Invoices,
│   │                 Credit Notes, Receipts, Allocate Receipts, Write-Offs, Adjustments)
│   ├── Reports (14 report types)
│   ├── Special (Opening Balances)
│   ├── Time Tracking
│   └── Debtors Manager
├── Suppliers
│   ├── Add a Supplier
│   ├── Lists (Suppliers, Supplier Categories)
│   ├── Transactions (POs, Invoices, Returns, Payments, Batch Payments,
│   │                 Allocate Payments, Adjustments)
│   ├── Reports (10 report types)
│   └── Special (Opening Balances)
├── Items
│   ├── Add an Item
│   ├── Lists (Items, Item Bundles, Item Categories)
│   ├── Transactions (Item Adjustments, Adjust Selling Prices)
│   ├── Special (Opening Balances, Renumber Codes)
│   └── Reports (11 report types)
├── Banking
│   ├── Add a Bank or Credit Card
│   ├── Lists (Banks, Categories, Quick Entry Rules, Statement Mapping Rules)
│   ├── Transactions (Banking, Reconcile, Manage Bank Feeds)
│   ├── Reports (5 report types)
│   └── Special (Opening Balances)
├── Accounts
│   ├── Add an Account
│   ├── Lists (Accounts, Item Accounts, Reporting Groups, Opening Balances)
│   └── Reports (Account Listing, Account Transactions)
├── Accountant's Area
│   ├── Journal Entries (Manual + Recurring)
│   ├── VAT (Returns, Adjustments, Payments/Refunds, DRC)
│   └── Reports (P&L, Balance Sheet, Trial Balance, Budget, Journals, Audit Trail)
├── Reports (Centralised hub for all module reports)
├── Company (Settings, Assets, Budgets, Tasks, Analysis Codes, Import/Export)
├── Administration (User Access, Password, Account)
└── AutoEntry (Document scanning integration)
```

---

## GAP ANALYSIS

### LEGEND
- ✅ EXISTS in FF — feature is implemented
- ⚠️ PARTIAL — exists but missing functionality vs Sage
- ❌ MISSING — not implemented in FF
- 🔗 CROSS-MODULE — exists in another FF module (needs GL integration)

---

### 1. CUSTOMERS / ACCOUNTS RECEIVABLE

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Customer Master Records | 🔗 | In `/suppliers` module (misnamed) — NOT in accounting |
| Customer Categories | 🔗 | In procurement/suppliers |
| Sales Reps | ❌ | Not implemented |
| Customer Quotes | 🔗 | `/procurement/quotes` — NO GL link |
| Customer Sales Orders | ❌ | Not in accounting or procurement |
| Customer Tax Invoices | ✅ | `/accounting/customer-invoices` |
| Customer Recurring Invoices | ❌ | Not implemented |
| Customer Credit Notes | ✅ | `/accounting/credit-notes` |
| Customer Receipts | ✅ | `/accounting/customer-payments` |
| Allocate Receipts | ⚠️ | Auto-allocation exists but no manual allocation UI |
| Customer Write-Offs | ❌ | Not implemented |
| Customer Adjustments | ❌ | Not implemented |
| Customer Statements | ✅ | `/accounting/customer-statements` |
| AR Aging | ✅ | `/accounting/ar-aging` |
| Customer Reports (14 types) | ⚠️ | Only aging + statements, missing 12 report types |
| Debtors Manager | ❌ | Not implemented (collections workflow) |

### 2. SUPPLIERS / ACCOUNTS PAYABLE

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Supplier Master Records | 🔗 | In `/procurement/sourcing?tab=suppliers` |
| Supplier Categories | 🔗 | In procurement |
| Supplier Purchase Orders | 🔗 | `/procurement/purchase-orders` — HAS GL link via GRN |
| Supplier Invoices | ✅ | `/accounting/supplier-invoices` |
| Supplier Returns | ✅ | `/accounting/supplier-returns` |
| Supplier Payments | ✅ | `/accounting/supplier-payments` |
| Supplier Batch Payments | ❌ | Not implemented |
| Allocate Payments | ⚠️ | Auto-allocation but no manual UI |
| Supplier Adjustments | ❌ | Not implemented |
| AP Aging | ✅ | `/accounting/ap-aging` |
| Supplier Reports (10 types) | ⚠️ | Only aging, missing 9 report types |

### 3. ITEMS / INVENTORY

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Item Master Records | 🔗 | `/procurement/stock-items` — NOT linked to accounting |
| Item Bundles | 🔗 | `/procurement/bundles` |
| Item Categories | 🔗 | `/procurement/stock-categories` |
| Item Adjustments | 🔗 | In procurement stock management |
| Selling Price Management | ❌ | Not in accounting |
| Item Reports (11 types) | ❌ | No accounting item reports |
| Item Valuation | ❌ | Not implemented |

### 4. BANKING

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Bank Accounts | ✅ | `/accounting/bank-accounts` |
| Import Bank Statements | ✅ | `/accounting/bank-reconciliation/import` (CSV parsers) |
| Bank Reconciliation | ✅ | `/accounting/bank-reconciliation` |
| Bank Transfers | ✅ | `/accounting/bank-transfers` |
| Manage Bank Feeds (auto) | ❌ | No automatic bank feed integration |
| Quick Entry Rules | ❌ | No auto-categorisation rules |
| Statement Mapping Rules | ❌ | No pattern-based auto-matching |
| Bank & CC Categories | ❌ | No bank account categories |
| Bank Reports (5 types) | ⚠️ | Cash flow only, missing 4 report types |

### 5. CHART OF ACCOUNTS / GENERAL LEDGER

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Chart of Accounts | ✅ | `/accounting/chart-of-accounts` |
| Account Reporting Groups | ❌ | Not implemented |
| Item Accounts (mapping) | ⚠️ | Default accounts exist but not per-item |
| Opening Balances | ✅ | `/accounting/opening-balances` |
| Account Reports | ⚠️ | Trial balance only, no account listing/transactions |

### 6. ACCOUNTANT'S AREA

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Journal Entries | ✅ | `/accounting/journal-entries` |
| Recurring Journals | ❌ | Not implemented |
| VAT Returns | ✅ | `/accounting/reports/vat-return` |
| VAT Adjustments | ❌ | Not implemented |
| VAT Payments & Refunds | ❌ | Not implemented |
| DRC VAT | ❌ | Not implemented |
| Trial Balance | ✅ | `/accounting/trial-balance` |
| Trial Balance Export | ❌ | Not implemented |
| Audit Trail | ❌ | Not implemented |
| System Audit Trail | ❌ | Not implemented |

### 7. REPORTS

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Income Statement (P&L) | ✅ | `/accounting/reports/income-statement` |
| Balance Sheet | ✅ | `/accounting/reports/balance-sheet` |
| Cash Flow | ✅ | `/accounting/reports/cash-flow` |
| VAT Return | ✅ | `/accounting/reports/vat-return` |
| Budget vs Actual | ✅ | `/accounting/reports/budget-vs-actual` |
| Project Profitability | ✅ | `/accounting/reports/project-profitability` (FF unique) |
| Centralised Reports Hub | ❌ | No unified report centre |

### 8. COMPANY / SETTINGS

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| Company Settings | ⚠️ | In FF `/settings` but not accounting-specific |
| Assets | 🔗 | FF has `/assets` module — NOT linked to accounting |
| Budgets | ⚠️ | Budget report exists but no budget creation |
| Analysis Codes | ❌ | Not implemented |
| Import/Export Data (CSV) | ⚠️ | Sage migration exists but no general CSV import/export |
| Year-End Processing | ✅ | `/accounting/year-end` |

### 9. ADMINISTRATION

| Sage Feature | FF Status | Notes |
|-------------|-----------|-------|
| User Access Control | ✅ | FF has RBAC system-wide |
| Multi-Currency | ❌ | Not implemented |

---

## CROSS-MODULE INTEGRATION GAPS

### Critical: Procurement → Accounting
| Flow | Current State | Required |
|------|--------------|----------|
| PO Created → GL | ❌ No GL entry | DR Commitment, CR Budget |
| GRN Confirmed → GL | ✅ `glIntegrationHooks.ts` | DR Materials, CR AP |
| Supplier Invoice → GL | ✅ In accounting module | DR Expense/AP, CR Bank |
| Procurement Quote → Customer Quote | ❌ No link | Quotes should flow to AR |

### Critical: Customer Invoices → GL
| Flow | Current State | Required |
|------|--------------|----------|
| Invoice Approved → GL | ✅ `postCustomerInvoiceToGL()` | DR AR, CR Revenue |
| Payment Received → GL | ✅ `postCustomerPaymentToGL()` | DR Bank, CR AR |
| Credit Note → GL | ⚠️ Partial | DR Revenue, CR AR |

### Missing: Assets → Accounting
| Flow | Current State | Required |
|------|--------------|----------|
| Asset Purchase → GL | ❌ | DR Asset, CR Bank/AP |
| Depreciation → GL | ❌ | DR Depreciation, CR Accumulated Depreciation |

### Missing: Payroll/Wages → Accounting
| Flow | Current State | Required |
|------|--------------|----------|
| Salary journals → GL | ❌ | DR Wages, CR Bank/PAYE/UIF |

---

## IMPLEMENTATION PLAN

### Phase 1: Core Alignment (HIGH PRIORITY)
**Goal:** Align navigation + fill critical transaction gaps

1. **Recurring Invoices** — Auto-generate customer invoices on schedule
2. **Customer Write-Offs** — Bad debt write-off with GL posting
3. **Customer/Supplier Adjustments** — Manual balance adjustments
4. **Manual Allocation UI** — Allocate receipts/payments to specific invoices
5. **Supplier Batch Payments** — Bulk payment processing
6. **Recurring Journals** — Schedule automated journal entries
7. **VAT Adjustments** — Manual VAT corrections

### Phase 2: Banking Intelligence (MEDIUM PRIORITY)
**Goal:** Smart bank transaction processing like Sage

8. **Quick Entry Rules** — Auto-categorise bank transactions by pattern
9. **Statement Mapping Rules** — Rule-based matching (payee → supplier/account)
10. **Auto-Match Enhancement** — Improve `autoMatch.ts` with configurable rules

### Phase 3: Reporting Parity (MEDIUM PRIORITY)
**Goal:** Match Sage's 50+ report types

11. **Customer Reports** — Sales by Customer, Customer Balances, Transactions, Invoices
12. **Supplier Reports** — Purchases by Supplier, Balances, Transactions, POs
13. **Banking Reports** — Bank Transactions, Cash Movement, Bank Feeds Audit
14. **Account Reports** — Account Listing, Account Transactions
15. **Audit Trail** — Full system audit trail report
16. **Centralised Reports Hub** — Unified `/accounting/reports` index page

### Phase 4: Cross-Module Integration (HIGH PRIORITY)
**Goal:** Ensure all financial events post to GL

17. **Procurement Quotes → AR Quotes** — Link procurement quotes to accounting
18. **PO Commitment Accounting** — GL entry on PO approval
19. **Asset → GL Integration** — Asset purchase + depreciation journals
20. **Credit Note GL Posting** — Complete credit note → GL flow
21. **Customer/Supplier Master Data** — Unified entity management or sync

### Phase 5: Advanced Features (LOW PRIORITY)
**Goal:** Feature parity with Sage premium features

22. **Multi-Currency** — Foreign currency transactions + revaluation
23. **Analysis Codes** — Custom reporting dimensions
24. **Budget Management** — Create + manage budgets (not just report)
25. **DRC VAT** — Domestic Reverse Charge handling
26. **Trial Balance Export** — Export for external accountants
27. **Customer Zone** — Online invoice portal for customers
28. **Bank Feeds** — Automatic bank statement import (Yodlee/similar)

---

## NAV RESTRUCTURE PROPOSAL

### Proposed FF Accounting Sidebar (Sage-Aligned)
```
Accounting
├── Dashboard                    ← Keep as-is (enhance with more widgets)
│
├── Customers (AR)               ← Sage: "Customers" menu
│   ├── Tax Invoices             ← Existing
│   ├── Recurring Invoices       ← NEW (Phase 1)
│   ├── Receipts                 ← Existing
│   ├── Allocate Receipts        ← NEW (Phase 1)
│   ├── Credit Notes             ← Existing
│   ├── Write-Offs               ← NEW (Phase 1)
│   ├── Adjustments              ← NEW (Phase 1)
│   ├── Aging                    ← Existing
│   └── Statements               ← Existing
│
├── Suppliers (AP)               ← Sage: "Suppliers" menu
│   ├── Invoices                 ← Existing
│   ├── Payments                 ← Existing
│   ├── Batch Payments           ← NEW (Phase 1)
│   ├── Allocate Payments        ← NEW (Phase 1)
│   ├── Returns                  ← Existing
│   ├── Adjustments              ← NEW (Phase 1)
│   └── Aging                    ← Existing
│
├── Banking                      ← Sage: "Banking" menu
│   ├── Bank Accounts            ← Existing
│   ├── Import Statement         ← Existing
│   ├── Reconcile                ← Existing
│   ├── Transfers                ← Existing
│   └── Mapping Rules            ← NEW (Phase 2)
│
├── General Ledger               ← Sage: "Accounts" + "Accountant's Area"
│   ├── Chart of Accounts        ← Existing
│   ├── Journal Entries          ← Existing
│   ├── Recurring Journals       ← NEW (Phase 1)
│   ├── Fiscal Periods           ← Existing
│   └── Default Accounts         ← Existing
│
├── VAT                          ← Sage: "Accountant's Area > VAT"
│   ├── VAT Return               ← Move from Reports
│   ├── VAT Adjustments          ← NEW (Phase 1)
│   └── VAT Payments             ← NEW (Phase 5)
│
├── Accountant                   ← Sage: "Accountant's Area"
│   ├── Trial Balance            ← Existing
│   ├── Opening Balances         ← Existing
│   ├── Year-End                 ← Existing
│   └── Audit Trail              ← NEW (Phase 3)
│
├── Reports                      ← Sage: "Reports" (centralised)
│   ├── Income Statement         ← Existing
│   ├── Balance Sheet            ← Existing
│   ├── Cash Flow                ← Existing
│   ├── Budget vs Actual         ← Existing
│   ├── Project Profitability    ← Existing (FF unique)
│   ├── Customer Reports         ← NEW (Phase 3)
│   ├── Supplier Reports         ← NEW (Phase 3)
│   ├── Banking Reports          ← NEW (Phase 3)
│   └── Account Reports          ← NEW (Phase 3)
│
└── Settings
    ├── Sage Migration           ← Existing (rename: "Data Import")
    └── Company Settings         ← Link to company financial settings
```

---

## EFFORT ESTIMATE

| Phase | Items | Complexity | Estimate |
|-------|-------|------------|----------|
| Phase 1 | 7 features | Medium | Core transaction types, GL posting hooks |
| Phase 2 | 3 features | Medium | Banking rules engine |
| Phase 3 | 6 features | Low-Medium | Reporting (queries + UI) |
| Phase 4 | 5 features | High | Cross-module integration, data model changes |
| Phase 5 | 7 features | High | Advanced features, external integrations |

### Priority Order
1. **Phase 1 + Phase 4** first — Core transactions + cross-module (unlocks Sage parity)
2. **Phase 3** next — Reports (high visibility, moderate effort)
3. **Phase 2** then — Banking intelligence (quality of life)
4. **Phase 5** last — Advanced features (nice to have)
