# Test Specification: Accounting Module

## Source

- **PRD/Spec**: `docs/PRDs/PRD-060-accounting-module.md`
- **Date Created**: 2026-02-24
- **Author**: Claude (PAI)

---

## Overview

Full accounting module for FibreFlow: General Ledger (double-entry), Chart of Accounts, Fiscal Periods, Accounts Payable, Accounts Receivable enhancements, Bank Reconciliation, Credit Notes, and Financial Reporting. Replaces Sage One as the system of record.

---

## Unit Tests

| ID | Description | Input | Expected Output | Priority |
|----|-------------|-------|-----------------|----------|
| UT-001 | Double-entry validation: balanced entry passes | Lines: DR 1000, CR 1000 | valid: true | HIGH |
| UT-002 | Double-entry validation: imbalanced entry fails | Lines: DR 1000, CR 999 | valid: false, difference: 1.00 | HIGH |
| UT-003 | Double-entry validation: empty lines fails | No lines | valid: false | HIGH |
| UT-004 | Double-entry validation: line with both debit and credit fails | DR 500, CR 500 on same line | valid: false | HIGH |
| UT-005 | Double-entry validation: negative amounts fail | DR -100, CR -100 | valid: false | HIGH |
| UT-006 | Double-entry validation: multi-line balanced | 3 DR lines, 2 CR lines, sum equal | valid: true | HIGH |
| UT-007 | Journal entry number generation | Year 2026, seq 1 | JE-2026-00001 | MEDIUM |
| UT-008 | Journal entry number generation | Year 2026, seq 99999 | JE-2026-99999 | MEDIUM |
| UT-009 | Fiscal period: date falls in correct period | 2026-03-15 | FY2026, period 3 | HIGH |
| UT-010 | Fiscal period: date outside any period | 2024-01-01 | null / not found | MEDIUM |
| UT-011 | AP aging: current bucket | Due tomorrow, balance R1000 | current: 1000 | HIGH |
| UT-012 | AP aging: 30-day bucket | Due 15 days ago, balance R500 | days_30: 500 | HIGH |
| UT-013 | AP aging: 60-day bucket | Due 45 days ago, balance R300 | days_60: 300 | HIGH |
| UT-014 | AP aging: 90-day bucket | Due 75 days ago, balance R200 | days_90: 200 | HIGH |
| UT-015 | AP aging: 120+ bucket | Due 150 days ago, balance R100 | days_120_plus: 100 | HIGH |
| UT-016 | AP aging: zero balance excluded | Fully paid invoice | not in results | MEDIUM |
| UT-017 | AR aging: same bucket logic for receivables | Various due dates | correct buckets | HIGH |
| UT-018 | 3-way match: PO=100, GRN=100, Invoice=100 | All match | fully_matched | HIGH |
| UT-019 | 3-way match: PO=100, GRN=90, Invoice=100 | GRN short | mismatch: grn_qty | HIGH |
| UT-020 | 3-way match: PO=100, GRN=100, Invoice=110 | Invoice over | mismatch: invoice_amount | HIGH |
| UT-021 | 3-way match: within tolerance (2%) | PO=100, GRN=100, Invoice=101.50 | matched (within 2%) | MEDIUM |
| UT-022 | Credit note amount calculation | Original subtotal R1000, tax 15% | CN subtotal: 1000, tax: 150, total: 1150 | HIGH |
| UT-023 | Bank CSV parse: FNB format | FNB CSV string | Array of BankTransaction objects | HIGH |
| UT-024 | Bank CSV parse: Standard Bank format | StdBank CSV string | Array of BankTransaction objects | HIGH |
| UT-025 | Bank CSV parse: Nedbank format | Nedbank CSV string | Array of BankTransaction objects | HIGH |
| UT-026 | Bank CSV parse: empty file | Empty string | empty array | MEDIUM |
| UT-027 | Bank CSV parse: malformed row skipped | Mixed valid/invalid rows | valid rows only, errors logged | MEDIUM |
| UT-028 | Bank auto-match: exact reference match | Bank ref "PAY-2026-00001" | matched to payment JL | HIGH |
| UT-029 | Bank auto-match: amount match within date range | Amount R45000, ±3 days | matched candidates | MEDIUM |
| UT-030 | Bank auto-match: no match found | Unknown reference | unmatched | MEDIUM |
| UT-031 | Trial balance: all debits equal all credits | Posted entries | total_debit = total_credit | HIGH |
| UT-032 | P&L: revenue minus expenses | Revenue 500K, expenses 300K | net profit 200K | HIGH |
| UT-033 | P&L: filter by project | Project A entries only | only Project A amounts | HIGH |
| UT-034 | Balance sheet: assets = liabilities + equity | All accounts | equation balances | HIGH |
| UT-035 | Payment allocation: partial payment | Invoice R10000, pay R6000 | allocated: 6000, balance: 4000 | HIGH |
| UT-036 | Payment allocation: overpayment rejected | Invoice R10000, pay R12000 | error: exceeds balance | HIGH |
| UT-037 | Payment allocation: multi-invoice | Pay R15000 across 2 invoices | both invoices updated | HIGH |

### Test File Location
`tests/unit/modules/accounting/double-entry.test.ts`
`tests/unit/modules/accounting/aging.test.ts`
`tests/unit/modules/accounting/three-way-match.test.ts`
`tests/unit/modules/accounting/bank-csv-parsers.test.ts`
`tests/unit/modules/accounting/bank-auto-match.test.ts`
`tests/unit/modules/accounting/reports.test.ts`
`tests/unit/modules/accounting/payments.test.ts`

---

## Integration Tests

| ID | Description | Components Involved | Expected Behavior | Priority |
|----|-------------|---------------------|-------------------|----------|
| IT-001 | Chart of accounts CRUD | API, DB | Create, read, update, deactivate account | HIGH |
| IT-002 | Chart of accounts: system account protected | API, DB | Cannot delete system account (AR, AP) | HIGH |
| IT-003 | Journal entry: create draft | API, DB | 201 with entry_number | HIGH |
| IT-004 | Journal entry: post balanced entry | API, DB, Trigger | Status → posted, totals calculated | HIGH |
| IT-005 | Journal entry: reject imbalanced post | API, DB, Trigger | 400 error, entry stays draft | HIGH |
| IT-006 | Journal entry: reject post to closed period | API, DB, Trigger | 400 error, period is closed | HIGH |
| IT-007 | Journal entry: reverse posted entry | API, DB | Creates new reversing JE, original marked reversed | HIGH |
| IT-008 | Fiscal period: create year generates 12 periods | API, DB | 12 records with correct dates | HIGH |
| IT-009 | Fiscal period: close period | API, DB | Status → closed | HIGH |
| IT-010 | Supplier invoice: create with items | API, DB | 201, items linked, totals calculated | HIGH |
| IT-011 | Supplier invoice: approve creates GL entry | API, DB, AutoPost | GL entry with DR Expense, CR AP | HIGH |
| IT-012 | Supplier invoice: match to PO | API, DB | match_status updated, PO amount_invoiced updated | HIGH |
| IT-013 | Supplier invoice: 3-way match validation | API, DB | Match status reflects PO/GRN/Invoice alignment | HIGH |
| IT-014 | Supplier payment: create with allocations | API, DB | Payment created, invoices amount_paid updated | HIGH |
| IT-015 | Supplier payment: process creates GL entry | API, DB, AutoPost | GL entry with DR AP, CR Bank | HIGH |
| IT-016 | Customer payment: create with allocations | API, DB | Payment created, customer_invoices updated | HIGH |
| IT-017 | Customer payment: process creates GL entry | API, DB, AutoPost | GL entry with DR Bank, CR AR | HIGH |
| IT-018 | Credit note: approve creates reversing GL entry | API, DB, AutoPost | Reversing GL entry posted | HIGH |
| IT-019 | Bank transaction: import CSV | API, DB | Transactions created with imported status | HIGH |
| IT-020 | Bank transaction: auto-match | API, DB | Matched transactions linked to GL lines | HIGH |
| IT-021 | Bank reconciliation: complete with zero difference | API, DB | Status → completed | HIGH |
| IT-022 | Bank reconciliation: reject non-zero difference | API, DB | 400 error, cannot complete | HIGH |
| IT-023 | Report: trial balance is balanced | API, DB | sum(debit) = sum(credit) | HIGH |
| IT-024 | Report: income statement by period | API, DB | Revenue/expense totals for period | HIGH |
| IT-025 | Report: balance sheet as at date | API, DB | Assets = Liabilities + Equity | HIGH |
| IT-026 | Report: AP aging buckets | API, DB | Correct bucket allocation | HIGH |
| IT-027 | Report: AR aging buckets | API, DB | Correct bucket allocation | HIGH |
| IT-028 | Report: VAT return | API, DB | Input VAT vs Output VAT | MEDIUM |
| IT-029 | Report: project profitability | API, DB | Revenue - expenses per project | HIGH |
| IT-030 | Auth: accounting endpoints require authentication | API, Auth | 401 without token | HIGH |

### Test File Location
`tests/api/accounting/chart-of-accounts.test.ts`
`tests/api/accounting/journal-entries.test.ts`
`tests/api/accounting/fiscal-periods.test.ts`
`tests/api/accounting/supplier-invoices.test.ts`
`tests/api/accounting/supplier-payments.test.ts`
`tests/api/accounting/customer-payments.test.ts`
`tests/api/accounting/credit-notes.test.ts`
`tests/api/accounting/bank-reconciliation.test.ts`
`tests/api/accounting/reports.test.ts`

---

## E2E Tests (Playwright)

| ID | User Flow | Steps | Expected Result | Priority |
|----|-----------|-------|-----------------|----------|
| E2E-001 | Accounting dashboard loads | 1. Navigate to /accounting | Dashboard with cash position, AP/AR, quick actions | HIGH |
| E2E-002 | Chart of accounts displays tree | 1. Navigate to /accounting/chart-of-accounts | Tree with Assets, Liabilities, Equity, Revenue, Expense | HIGH |
| E2E-003 | Create GL account | 1. Click Add Account 2. Fill form 3. Save | New account in tree | HIGH |
| E2E-004 | Create manual journal entry | 1. Navigate to /accounting/journal-entries/new 2. Add lines 3. Save as draft | Draft entry created | HIGH |
| E2E-005 | Post journal entry | 1. Open draft JE 2. Click Post | Status → Posted, totals shown | HIGH |
| E2E-006 | Reject imbalanced journal entry | 1. Create JE with unbalanced lines 2. Try to post | Error message: not balanced | HIGH |
| E2E-007 | Create supplier invoice | 1. Navigate to /accounting/supplier-invoices/new 2. Fill form with items 3. Save | Invoice created with number | HIGH |
| E2E-008 | Approve supplier invoice | 1. Open invoice 2. Click Approve | Status → Approved, GL entry created | HIGH |
| E2E-009 | Create supplier payment run | 1. Navigate to payments 2. Select invoices due 3. Create batch 4. Process | Payments processed, invoices marked paid | HIGH |
| E2E-010 | Record customer payment | 1. Navigate to customer payments 2. Select invoices 3. Enter amount 4. Process | Payment recorded, invoices updated | HIGH |
| E2E-011 | Import bank statement | 1. Navigate to bank recon 2. Upload CSV 3. Verify imported rows | Transactions imported with counts | HIGH |
| E2E-012 | Auto-match bank transactions | 1. After import 2. Click Auto-Match | Matched count displayed | HIGH |
| E2E-013 | Complete bank reconciliation | 1. Match all transactions 2. Difference = R0.00 3. Click Complete | Status → Completed | HIGH |
| E2E-014 | View Trial Balance report | 1. Navigate to reports 2. Select Trial Balance | Report with balanced debit/credit totals | HIGH |
| E2E-015 | View Income Statement | 1. Navigate to reports 2. Select P&L 3. Filter by project | Revenue, expenses, net profit shown | HIGH |
| E2E-016 | View Balance Sheet | 1. Navigate to reports 2. Select Balance Sheet | Assets = Liabilities + Equity | HIGH |
| E2E-017 | View AP Aging report | 1. Navigate to reports 2. Select AP Aging | Suppliers with aging buckets | HIGH |
| E2E-018 | View AR Aging report | 1. Navigate to reports 2. Select AR Aging | Clients with aging buckets | HIGH |
| E2E-019 | Accounting pages load without errors | Navigate to each /accounting/* page | No 404/500, content renders | HIGH |
| E2E-020 | API health: all accounting endpoints respond | GET each /api/accounting/* list endpoint | 200 with success:true | HIGH |

### Test File Location
`tests/e2e/accounting-module.spec.ts`

---

## Acceptance Criteria Mapping

- [ ] **AC-2.1a**: Chart of accounts tree → `UT-001`, `IT-001`, `E2E-002`
- [ ] **AC-2.1b**: Manual journal entries → `UT-001`-`UT-006`, `IT-003`-`IT-007`, `E2E-004`-`E2E-006`
- [ ] **AC-2.1c**: Fiscal period management → `UT-009`-`UT-010`, `IT-008`-`IT-009`
- [ ] **AC-2.2a**: Bank statement import → `UT-023`-`UT-027`, `IT-019`, `E2E-011`
- [ ] **AC-2.2b**: Bank auto-match → `UT-028`-`UT-030`, `IT-020`, `E2E-012`
- [ ] **AC-2.2c**: Reconciliation completion → `IT-021`-`IT-022`, `E2E-013`
- [ ] **AC-2.3a**: AP aging report → `UT-011`-`UT-016`, `IT-026`, `E2E-017`
- [ ] **AC-2.3b**: Payment runs → `UT-035`-`UT-037`, `IT-014`-`IT-015`, `E2E-009`
- [ ] **AC-2.4a**: Financial reports → `UT-031`-`UT-034`, `IT-023`-`IT-025`, `E2E-014`-`E2E-016`
- [ ] **AC-2.5**: Project P&L → `UT-033`, `IT-029`, `E2E-015`
- [ ] **AC-2.6a**: Supplier invoice capture → `UT-018`-`UT-021`, `IT-010`-`IT-013`, `E2E-007`-`E2E-008`
- [ ] **AC-2.7**: Auto-posting hooks → `IT-011`, `IT-015`, `IT-017`, `IT-018`

---

## Edge Cases

| Scenario | Expected Behavior | Test ID |
|----------|-------------------|---------|
| Post entry with R0.01 rounding difference | Reject (enforce exact balance) | UT-002 |
| Delete account with posted transactions | Block deletion, return error | IT-002 |
| Close period that has draft entries | Warn, allow close, drafts cannot be posted | IT-009 |
| Supplier payment exceeds invoice balance | Reject, return overpayment error | UT-036 |
| Bank CSV with duplicate transactions | Skip duplicates (by date+amount+ref) | UT-027 |
| Year-end close with open transactions | Block until all entries posted | - |
| Concurrent journal entry posting | Sequential processing (no race) | - |
| Very large bank statement (5000+ rows) | Process within 30s timeout | - |

---

## Notes

- Database mocks: `@neondatabase/serverless` auto-mocked in vitest.setup.ts
- Auth mock: Full admin user auto-mocked in vitest.setup.ts
- E2E tests run against `dev.fibreflow.app` via Playwright
- E2E auth: saved session from `tests/e2e/auth.setup.ts`
- Integration tests use separate `vitest.integration.config.ts` with real DB

---

## Checklist

Before implementation:
- [x] All acceptance criteria have mapped tests
- [x] Edge cases identified
- [x] Test file locations decided
- [x] Priority assigned to each test

After test creation:
- [ ] Tests are failing (RED phase)
- [ ] Test descriptions match behavior
- [ ] No trivial tests (DGTS compliant)
