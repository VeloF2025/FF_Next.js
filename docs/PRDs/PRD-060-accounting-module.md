# PRD-060: FibreFlow Accounting Module

## Document Information
- **PRD Number**: PRD-060
- **Title**: FibreFlow Accounting Module
- **Author**: Claude (PAI)
- **Created**: 2026-02-24
- **Status**: Draft
- **Priority**: Critical
- **Replaces**: Sage One integration (migration path provided)

---

## 1. Overview

### 1.1 Problem Statement
FibreFlow currently offloads all accounting to Sage One (South Africa). This creates:
- **Dual data entry**: POs, invoices, and payments exist in both systems with manual reconciliation
- **No real-time financial visibility**: Sage sync runs every 15 minutes; data is always stale
- **Licensing cost**: Sage per-user fees increase with team growth
- **Integration brittleness**: Sage OAuth tokens expire, API changes break sync
- **No project-level P&L**: Sage lacks fiber-construction-specific reporting (cost per drop, project profitability by zone)
- **No native bank reconciliation**: Sage bank recon is a documented weak point

FibreFlow already has 60% of the financial plumbing (POs, customer invoicing, budgets, cost centers, approval workflows). The missing 40% is the accounting engine itself: general ledger, AP/AR, bank reconciliation, and financial reporting.

### 1.2 Solution Summary
Build a native double-entry accounting module directly into FibreFlow that:
- Adds a General Ledger with proper double-entry journal entries
- Promotes the existing `budget_transactions` to GL-backed entries
- Provides native Chart of Accounts (migrating from Sage cache)
- Adds Accounts Payable with supplier invoice capture, 3-way matching, and payment runs
- Enhances Accounts Receivable with proper payment allocation and aging
- Adds bank reconciliation (CSV import from SA banks)
- Generates financial reports (P&L, balance sheet, trial balance, cash flow, VAT return)
- Manages fiscal periods with year-end close
- Integrates seamlessly with existing procurement, invoicing, and budget modules

### 1.3 Success Metrics
- 100% of financial transactions produce balanced GL journal entries (debit = credit)
- Trial balance balances to zero at all times
- Native P&L matches Sage P&L within R1.00 during parallel-run period
- Bank reconciliation difference reaches R0.00 for each statement period
- AP/AR aging reports available in real-time (no sync delay)
- Sage dependency eliminated within 6 months of Phase 1 completion

---

## 2. User Stories

### 2.1 Accountant
```
As an Accountant
I want a native chart of accounts and general ledger in FibreFlow
So that I can manage the company's books without switching to Sage
```

**Acceptance Criteria:**
- [ ] Chart of accounts with tree structure (assets/liabilities/equity/revenue/expense)
- [ ] Create, edit, deactivate GL accounts
- [ ] Manual journal entries with balanced debit/credit enforcement
- [ ] Journal entry approval workflow (draft → posted)
- [ ] Reverse posted journal entries with audit trail
- [ ] Fiscal period management (open, close, lock periods)
- [ ] Year-end closing entry auto-generated (revenue/expense → retained earnings)
- [ ] All auto-posted entries visible with source document links

### 2.2 Accountant — Bank Reconciliation
```
As an Accountant
I want to import bank statements and reconcile them against GL entries
So that I can verify all transactions are recorded accurately
```

**Acceptance Criteria:**
- [ ] Import CSV bank statements (FNB, Standard Bank, Nedbank formats)
- [ ] Auto-match bank transactions to GL journal lines by reference and amount
- [ ] Manual match/unmatch for unrecognized transactions
- [ ] Create adjustment journal entries for bank fees, interest, etc.
- [ ] Reconciliation difference must reach R0.00 to complete
- [ ] Historical reconciliation records with completion audit trail

### 2.3 Finance Manager
```
As a Finance Manager
I want AP/AR aging reports and payment run capabilities
So that I can manage cash flow and ensure timely payments
```

**Acceptance Criteria:**
- [ ] AP aging report: Current, 30, 60, 90, 120+ day buckets
- [ ] AR aging report: same buckets for customer invoices
- [ ] Supplier payment run: select invoices due → generate batch → approve → process
- [ ] Payment allocation across multiple invoices (partial payments supported)
- [ ] Customer statement generation per client per period
- [ ] Dashboard showing cash position, AP/AR totals, overdue amounts

### 2.4 Finance Manager — Reporting
```
As a Finance Manager
I want financial statements generated from the GL
So that I can assess company financial health without Sage
```

**Acceptance Criteria:**
- [ ] Trial Balance report (all accounts with debit/credit totals)
- [ ] Income Statement (P&L) — by period, by project, by cost center
- [ ] Balance Sheet — as at any date
- [ ] Cash Flow Statement — operating, investing, financing sections
- [ ] VAT Return report — Input VAT vs Output VAT per period
- [ ] All reports exportable to PDF and Excel
- [ ] Comparative reports (current period vs prior period)

### 2.5 Project Manager
```
As a Project Manager
I want to see project-level P&L backed by the general ledger
So that I can track true profitability per project
```

**Acceptance Criteria:**
- [ ] Project P&L shows revenue (customer invoices) vs expenses (supplier invoices, labor, materials)
- [ ] Budget vs GL actual variance report
- [ ] Cost per drop calculation from GL data
- [ ] Margin percentage per project
- [ ] Drill-down from summary to individual journal entries

### 2.6 Procurement Officer
```
As a Procurement Officer
I want to capture supplier invoices and match them to POs and GRNs
So that payments are only made for verified deliveries
```

**Acceptance Criteria:**
- [ ] Create supplier invoice with line items
- [ ] Auto-match to PO by supplier + reference
- [ ] 3-way match validation: PO quantity vs GRN received vs Invoice quantity
- [ ] Flag mismatches for review (tolerance configurable)
- [ ] Supplier invoice approval workflow
- [ ] GL journal entry auto-created on approval (DR Expense/Inventory, CR AP)

### 2.7 System — Auto-Posting
```
As the System
I want financial events to automatically create GL journal entries
So that the ledger is always current without manual bookkeeping
```

**Acceptance Criteria:**
- [ ] Customer invoice approved → DR AR, CR Revenue + CR VAT Output
- [ ] Customer payment received → DR Bank, CR AR
- [ ] GRN completed → DR Inventory/Expense + DR VAT Input, CR AP
- [ ] Supplier payment made → DR AP, CR Bank
- [ ] Stock consumption (picking completed) → DR Cost of Sales, CR Inventory
- [ ] Credit note approved → reverses original journal entry
- [ ] All auto-posted entries link back to source document
- [ ] Auto-posting respects fiscal period (rejects posting to closed period)

### 2.8 System — Credit/Debit Notes
```
As the System
I want credit and debit note handling
So that corrections and returns are properly recorded
```

**Acceptance Criteria:**
- [ ] Customer credit note reduces AR and reverses revenue
- [ ] Supplier credit note reduces AP and reverses expense
- [ ] Credit notes link to original invoice
- [ ] GL entries auto-created on credit note approval
- [ ] Credit note numbers: CN-YYYY-NNNNN sequence

---

## 3. Functional Requirements

### 3.1 General Ledger Engine

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1.1 | System SHALL enforce double-entry: total_debit = total_credit per journal entry | Must |
| FR-3.1.2 | System SHALL prevent posting to closed fiscal periods | Must |
| FR-3.1.3 | System SHALL auto-generate entry numbers (JE-YYYY-NNNNN) | Must |
| FR-3.1.4 | System SHALL support manual and auto-posted journal entries | Must |
| FR-3.1.5 | System SHALL allow reversal of posted entries (creates contra entry) | Must |
| FR-3.1.6 | System SHALL link auto-posted entries to source documents (invoice, payment, GRN) | Must |
| FR-3.1.7 | Journal lines SHALL carry optional project_id and cost_center_id | Must |
| FR-3.1.8 | System SHALL validate debit OR credit is zero per line (not both positive) | Must |
| FR-3.1.9 | System SHALL support draft → posted → reversed lifecycle | Must |
| FR-3.1.10 | Posted entries SHALL be immutable (reversal required for corrections) | Must |

### 3.2 Chart of Accounts

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.2.1 | System SHALL provide hierarchical chart of accounts (tree structure) | Must |
| FR-3.2.2 | Account types: asset, liability, equity, revenue, expense | Must |
| FR-3.2.3 | System accounts (AR, AP, VAT, Retained Earnings) SHALL be protected from deletion | Must |
| FR-3.2.4 | Accounts with posted transactions SHALL not be deletable | Must |
| FR-3.2.5 | System SHALL seed SA construction company chart on first setup | Must |
| FR-3.2.6 | Migration SHALL map existing sage_accounts to gl_accounts | Must |
| FR-3.2.7 | Bank accounts SHALL be flagged as reconcilable | Must |
| FR-3.2.8 | Each account SHALL have optional default tax_rate | Should |

### 3.3 Fiscal Period Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.3.1 | System SHALL manage fiscal years with 12 monthly periods | Must |
| FR-3.3.2 | Only open periods SHALL accept new postings | Must |
| FR-3.3.3 | Period close SHALL prevent further postings | Must |
| FR-3.3.4 | Year-end close SHALL generate retained earnings entry | Must |
| FR-3.3.5 | Locked periods SHALL be immutable (even for admin) | Should |
| FR-3.3.6 | System SHALL auto-create next fiscal year periods | Should |

### 3.4 Accounts Payable

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.4.1 | System SHALL capture supplier invoices with line items | Must |
| FR-3.4.2 | System SHALL auto-match invoices to POs by supplier + reference | Must |
| FR-3.4.3 | System SHALL validate 3-way match (PO qty vs GRN received vs Invoice qty) | Must |
| FR-3.4.4 | Mismatches beyond tolerance SHALL be flagged for review | Must |
| FR-3.4.5 | Approved supplier invoices SHALL auto-post GL entries | Must |
| FR-3.4.6 | System SHALL support supplier payment runs (batch) | Must |
| FR-3.4.7 | Payments SHALL support allocation across multiple invoices | Must |
| FR-3.4.8 | System SHALL generate AP aging report (Current/30/60/90/120+) | Must |
| FR-3.4.9 | System SHALL track payment_terms and calculate due_date | Must |
| FR-3.4.10 | Supplier invoices SHALL replace sage_supplier_invoices as system of record | Must |

### 3.5 Accounts Receivable Enhancements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.5.1 | Customer payments SHALL be recorded with bank reference | Must |
| FR-3.5.2 | Payments SHALL support allocation to specific invoices | Must |
| FR-3.5.3 | System SHALL generate AR aging report | Must |
| FR-3.5.4 | System SHALL generate customer statements per period | Must |
| FR-3.5.5 | Existing customer_invoices SHALL auto-post GL entries on approval | Must |
| FR-3.5.6 | System SHALL support credit notes (customer and supplier) | Must |
| FR-3.5.7 | Overdue invoices SHALL be flagged automatically | Should |

### 3.6 Bank Reconciliation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.6.1 | System SHALL import bank statements from CSV (FNB, Standard Bank, Nedbank) | Must |
| FR-3.6.2 | System SHALL auto-match transactions by reference + amount | Must |
| FR-3.6.3 | System SHALL support manual match/unmatch | Must |
| FR-3.6.4 | System SHALL display reconciliation difference (must be R0.00 to complete) | Must |
| FR-3.6.5 | System SHALL allow creating adjustment entries from bank recon screen | Should |
| FR-3.6.6 | System SHALL maintain reconciliation history | Must |

### 3.7 Financial Reporting

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.7.1 | System SHALL generate Trial Balance | Must |
| FR-3.7.2 | System SHALL generate Income Statement (P&L) | Must |
| FR-3.7.3 | System SHALL generate Balance Sheet | Must |
| FR-3.7.4 | System SHALL generate Cash Flow Statement | Should |
| FR-3.7.5 | System SHALL generate VAT Return report | Must |
| FR-3.7.6 | System SHALL generate AP/AR Aging reports | Must |
| FR-3.7.7 | Reports SHALL support filtering by project, cost center, period | Must |
| FR-3.7.8 | Reports SHALL be exportable to PDF and Excel | Must |
| FR-3.7.9 | System SHALL generate project profitability report | Must |
| FR-3.7.10 | Reports SHALL support comparative periods | Should |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | Journal entry posting time | < 500ms |
| NFR-002 | Trial balance generation | < 2 seconds |
| NFR-003 | Bank statement import (1000 rows) | < 10 seconds |
| NFR-004 | Bank auto-match processing | < 5 seconds |
| NFR-005 | Report generation (P&L, BS) | < 3 seconds |
| NFR-006 | AP/AR aging calculation | < 2 seconds |
| NFR-007 | GL data integrity (debit=credit) | 100% at all times |
| NFR-008 | Concurrent users on accounting pages | 10+ without degradation |
| NFR-009 | Audit trail completeness | 100% of financial mutations logged |
| NFR-010 | Test coverage for accounting module | >= 80% |

---

## 5. Technical Design

### 5.1 Database Schema

#### 5.1.1 Migration 200: Accounting Foundation

```sql
-- ============================================================
-- Migration 200: Accounting Foundation
-- GL Accounts, Journal Entries, Fiscal Periods
-- ============================================================

-- Enum types
CREATE TYPE gl_account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE gl_account_subtype AS ENUM (
  'bank', 'receivable', 'payable', 'tax', 'inventory',
  'fixed_asset', 'accumulated_depreciation', 'cost_of_sales',
  'revenue', 'operating_expense', 'equity', 'retained_earnings',
  'other_current_asset', 'other_current_liability', 'other'
);
CREATE TYPE gl_entry_source AS ENUM (
  'manual', 'customer_invoice', 'customer_payment', 'supplier_invoice',
  'supplier_payment', 'grn', 'stock_consumption', 'credit_note',
  'depreciation', 'closing', 'adjustment', 'opening_balance'
);
CREATE TYPE gl_entry_status AS ENUM ('draft', 'posted', 'reversed');
CREATE TYPE fiscal_period_status AS ENUM ('open', 'closing', 'closed', 'locked');

-- ── Chart of Accounts ──────────────────────────────────────
CREATE TABLE gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(20) NOT NULL UNIQUE,
    account_name VARCHAR(255) NOT NULL,
    account_type gl_account_type NOT NULL,
    account_subtype gl_account_subtype NOT NULL DEFAULT 'other',
    parent_id UUID REFERENCES gl_accounts(id),

    description TEXT,
    tax_rate DECIMAL(5,2),
    is_system_account BOOLEAN DEFAULT false,
    is_reconcilable BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,

    -- Migration link
    sage_account_id VARCHAR(100),

    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_gl_accounts_type ON gl_accounts(account_type);
CREATE INDEX idx_gl_accounts_parent ON gl_accounts(parent_id);
CREATE INDEX idx_gl_accounts_code ON gl_accounts(account_code);

-- ── Fiscal Periods ─────────────────────────────────────────
CREATE TABLE gl_fiscal_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year VARCHAR(10) NOT NULL,
    period_number INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 13),
    period_name VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status fiscal_period_status DEFAULT 'open',

    closed_by VARCHAR(255),
    closed_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(255),
    locked_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(fiscal_year, period_number),
    CHECK (end_date >= start_date)
);

CREATE INDEX idx_fiscal_periods_dates ON gl_fiscal_periods(start_date, end_date);
CREATE INDEX idx_fiscal_periods_status ON gl_fiscal_periods(status);

-- ── Journal Entries ────────────────────────────────────────
CREATE TABLE gl_journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_number VARCHAR(20) NOT NULL UNIQUE,
    entry_date DATE NOT NULL,
    posting_date DATE NOT NULL,
    fiscal_period_id UUID NOT NULL REFERENCES gl_fiscal_periods(id),

    source_type gl_entry_source NOT NULL DEFAULT 'manual',
    source_id UUID,
    description TEXT NOT NULL,
    reference VARCHAR(255),

    status gl_entry_status DEFAULT 'draft',
    total_debit DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_credit DECIMAL(15,2) NOT NULL DEFAULT 0,

    project_id UUID,
    cost_center_id UUID,

    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    posted_by VARCHAR(255),
    posted_at TIMESTAMP WITH TIME ZONE,
    reversed_by_entry_id UUID REFERENCES gl_journal_entries(id),
    reversed_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_gl_je_date ON gl_journal_entries(entry_date);
CREATE INDEX idx_gl_je_status ON gl_journal_entries(status);
CREATE INDEX idx_gl_je_source ON gl_journal_entries(source_type, source_id);
CREATE INDEX idx_gl_je_period ON gl_journal_entries(fiscal_period_id);
CREATE INDEX idx_gl_je_project ON gl_journal_entries(project_id);

-- ── Journal Lines ──────────────────────────────────────────
CREATE TABLE gl_journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES gl_journal_entries(id) ON DELETE CASCADE,
    gl_account_id UUID NOT NULL REFERENCES gl_accounts(id),
    line_number INTEGER NOT NULL DEFAULT 1,

    debit DECIMAL(15,2) NOT NULL DEFAULT 0,
    credit DECIMAL(15,2) NOT NULL DEFAULT 0,
    description TEXT,

    project_id UUID,
    cost_center_id UUID,
    tax_code VARCHAR(20),
    tax_amount DECIMAL(15,2) DEFAULT 0,

    reconciliation_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT chk_debit_or_credit CHECK (
        (debit >= 0 AND credit >= 0) AND (debit = 0 OR credit = 0)
    )
);

CREATE INDEX idx_gl_jl_entry ON gl_journal_lines(journal_entry_id);
CREATE INDEX idx_gl_jl_account ON gl_journal_lines(gl_account_id);
CREATE INDEX idx_gl_jl_recon ON gl_journal_lines(reconciliation_id);
CREATE INDEX idx_gl_jl_project ON gl_journal_lines(project_id);

-- ── Sequence for Journal Entry Numbers ─────────────────────
CREATE SEQUENCE gl_journal_entry_seq START WITH 1;

-- ── Functions ──────────────────────────────────────────────

-- Generate journal entry number
CREATE OR REPLACE FUNCTION generate_journal_entry_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.entry_number IS NULL OR NEW.entry_number = '' THEN
        NEW.entry_number := 'JE-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
            || '-' || LPAD(nextval('gl_journal_entry_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_gl_je_number
    BEFORE INSERT ON gl_journal_entries
    FOR EACH ROW EXECUTE FUNCTION generate_journal_entry_number();

-- Enforce balanced journal entry on posting
CREATE OR REPLACE FUNCTION enforce_balanced_entry()
RETURNS TRIGGER AS $$
DECLARE
    total_dr DECIMAL(15,2);
    total_cr DECIMAL(15,2);
BEGIN
    IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
        SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
        INTO total_dr, total_cr
        FROM gl_journal_lines
        WHERE journal_entry_id = NEW.id;

        IF ABS(total_dr - total_cr) > 0.01 THEN
            RAISE EXCEPTION 'Journal entry % is not balanced: debit=% credit=%',
                NEW.entry_number, total_dr, total_cr;
        END IF;

        -- Update totals
        NEW.total_debit := total_dr;
        NEW.total_credit := total_cr;
        NEW.posted_at := NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_gl_je_balanced
    BEFORE UPDATE ON gl_journal_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_balanced_entry();

-- Prevent posting to closed/locked periods
CREATE OR REPLACE FUNCTION check_fiscal_period_open()
RETURNS TRIGGER AS $$
DECLARE
    period_status fiscal_period_status;
BEGIN
    IF NEW.status = 'posted' THEN
        SELECT status INTO period_status
        FROM gl_fiscal_periods
        WHERE id = NEW.fiscal_period_id;

        IF period_status != 'open' THEN
            RAISE EXCEPTION 'Cannot post to % fiscal period',
                period_status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_gl_je_period_check
    BEFORE UPDATE ON gl_journal_entries
    FOR EACH ROW EXECUTE FUNCTION check_fiscal_period_open();

-- Prevent modification of posted entries
CREATE OR REPLACE FUNCTION prevent_posted_entry_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'posted' AND NEW.status = 'posted' THEN
        -- Only allow status change to 'reversed'
        IF NEW.status != 'reversed' AND OLD.status = 'posted' THEN
            -- Allow updating reversed_by_entry_id and reversed_at
            IF NEW.reversed_by_entry_id IS DISTINCT FROM OLD.reversed_by_entry_id THEN
                RETURN NEW;
            END IF;
            RAISE EXCEPTION 'Cannot modify posted journal entry %. Create a reversing entry instead.',
                OLD.entry_number;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Seed: SA Construction Chart of Accounts ────────────────

-- Assets
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, is_system_account, is_reconcilable) VALUES
('1000', 'Assets', 'asset', 'other', true, false),
('1100', 'Current Assets', 'asset', 'other_current_asset', false, false),
('1110', 'Bank - FNB Current', 'asset', 'bank', false, true),
('1120', 'Bank - FNB Savings', 'asset', 'bank', false, true),
('1130', 'Petty Cash', 'asset', 'bank', false, true),
('1200', 'Accounts Receivable', 'asset', 'receivable', true, false),
('1210', 'Client Retention Receivable', 'asset', 'receivable', false, false),
('1300', 'Inventory', 'asset', 'inventory', true, false),
('1400', 'VAT Input', 'asset', 'tax', true, false),
('1500', 'Fixed Assets', 'asset', 'fixed_asset', false, false),
('1510', 'Vehicles', 'asset', 'fixed_asset', false, false),
('1520', 'Equipment', 'asset', 'fixed_asset', false, false),
('1530', 'Accumulated Depreciation', 'asset', 'accumulated_depreciation', false, false);

-- Set parent relationships
UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '1000') WHERE account_code IN ('1100', '1500');
UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '1100') WHERE account_code IN ('1110', '1120', '1130', '1200', '1210', '1300', '1400');
UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '1500') WHERE account_code IN ('1510', '1520', '1530');

-- Liabilities
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, is_system_account) VALUES
('2000', 'Liabilities', 'liability', 'other', true),
('2100', 'Current Liabilities', 'liability', 'other_current_liability', false),
('2110', 'Accounts Payable', 'liability', 'payable', true),
('2120', 'VAT Output', 'liability', 'tax', true),
('2130', 'PAYE Payable', 'liability', 'tax', false),
('2140', 'UIF Payable', 'liability', 'tax', false),
('2150', 'Accrued Expenses', 'liability', 'other_current_liability', false),
('2200', 'Retention Payable', 'liability', 'payable', false);

UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '2000') WHERE account_code IN ('2100', '2200');
UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '2100') WHERE account_code IN ('2110', '2120', '2130', '2140', '2150');

-- Equity
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, is_system_account) VALUES
('3000', 'Equity', 'equity', 'equity', true),
('3100', 'Owner''s Equity', 'equity', 'equity', false),
('3200', 'Retained Earnings', 'equity', 'retained_earnings', true);

UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '3000') WHERE account_code IN ('3100', '3200');

-- Revenue
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, is_system_account, tax_rate) VALUES
('4000', 'Revenue', 'revenue', 'revenue', true, NULL),
('4100', 'Drop Activation Income', 'revenue', 'revenue', false, 15),
('4200', 'Bonus Income', 'revenue', 'revenue', false, 15),
('4300', 'Other Income', 'revenue', 'revenue', false, 15);

UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '4000') WHERE account_code IN ('4100', '4200', '4300');

-- Cost of Sales
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, tax_rate) VALUES
('5000', 'Cost of Sales', 'expense', 'cost_of_sales', NULL),
('5100', 'Materials', 'expense', 'cost_of_sales', 15),
('5200', 'Subcontractor Costs', 'expense', 'cost_of_sales', 15),
('5300', 'Labor - Direct', 'expense', 'cost_of_sales', NULL),
('5400', 'Equipment Hire', 'expense', 'cost_of_sales', 15),
('5500', 'Transport - Direct', 'expense', 'cost_of_sales', 15);

UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '5000') WHERE account_code IN ('5100', '5200', '5300', '5400', '5500');

-- Operating Expenses
INSERT INTO gl_accounts (account_code, account_name, account_type, account_subtype, tax_rate) VALUES
('6000', 'Operating Expenses', 'expense', 'operating_expense', NULL),
('6100', 'Salaries & Wages', 'expense', 'operating_expense', NULL),
('6200', 'Vehicle Expenses', 'expense', 'operating_expense', 15),
('6300', 'Office & Admin', 'expense', 'operating_expense', 15),
('6400', 'Insurance', 'expense', 'operating_expense', NULL),
('6500', 'Depreciation', 'expense', 'operating_expense', NULL),
('6600', 'Bank Charges', 'expense', 'operating_expense', NULL),
('6700', 'Contingency', 'expense', 'operating_expense', NULL);

UPDATE gl_accounts SET parent_id = (SELECT id FROM gl_accounts WHERE account_code = '6000') WHERE account_code IN ('6100', '6200', '6300', '6400', '6500', '6600', '6700');

-- Budget category → GL account mapping (default)
-- MATERIALS → 5100, EQUIPMENT → 5400, LABOR → 5300,
-- SUBCONTRACT → 5200, TRANSPORT → 5500, OVERHEAD → 6300, CONTINGENCY → 6700
```

#### 5.1.2 Migration 201: Accounts Payable

```sql
-- ============================================================
-- Migration 201: Accounts Payable
-- Supplier Invoices, Payments, Payment Allocations
-- ============================================================

CREATE TYPE supplier_invoice_status AS ENUM (
    'draft', 'pending_approval', 'approved', 'partially_paid',
    'paid', 'disputed', 'cancelled'
);
CREATE TYPE invoice_match_status AS ENUM (
    'unmatched', 'po_matched', 'grn_matched', 'fully_matched'
);
CREATE TYPE payment_method AS ENUM ('eft', 'cheque', 'cash', 'card');
CREATE TYPE payment_status AS ENUM (
    'draft', 'approved', 'processed', 'reconciled', 'cancelled'
);

CREATE TABLE supplier_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(100) NOT NULL,
    supplier_id UUID NOT NULL,
    purchase_order_id UUID,
    grn_id UUID,

    invoice_date DATE NOT NULL,
    due_date DATE,
    received_date DATE DEFAULT CURRENT_DATE,

    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 15,
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    amount_paid DECIMAL(15,2) DEFAULT 0,
    balance DECIMAL(15,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,

    payment_terms VARCHAR(50),
    currency VARCHAR(3) DEFAULT 'ZAR',
    reference VARCHAR(255),

    status supplier_invoice_status DEFAULT 'draft',
    match_status invoice_match_status DEFAULT 'unmatched',

    project_id UUID,
    cost_center_id UUID,
    gl_journal_entry_id UUID REFERENCES gl_journal_entries(id),

    -- Migration: link to old sage_supplier_invoices
    sage_invoice_id VARCHAR(100),

    notes TEXT,
    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_si_supplier ON supplier_invoices(supplier_id);
CREATE INDEX idx_si_po ON supplier_invoices(purchase_order_id);
CREATE INDEX idx_si_status ON supplier_invoices(status);
CREATE INDEX idx_si_due_date ON supplier_invoices(due_date);
CREATE INDEX idx_si_project ON supplier_invoices(project_id);

CREATE TABLE supplier_invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    po_item_id UUID,

    description TEXT NOT NULL,
    quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 15,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) NOT NULL DEFAULT 0,

    gl_account_id UUID REFERENCES gl_accounts(id),
    project_id UUID,
    cost_center_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sii_invoice ON supplier_invoice_items(supplier_invoice_id);

-- Supplier invoice number sequence
CREATE SEQUENCE supplier_invoice_seq START WITH 1;

-- ── Supplier Payments ──────────────────────────────────────

CREATE TABLE supplier_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(20) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL,
    payment_date DATE NOT NULL,

    total_amount DECIMAL(15,2) NOT NULL,
    payment_method payment_method NOT NULL DEFAULT 'eft',
    bank_account_id UUID REFERENCES gl_accounts(id),

    reference VARCHAR(255),
    description TEXT,

    status payment_status DEFAULT 'draft',
    gl_journal_entry_id UUID REFERENCES gl_journal_entries(id),
    batch_id UUID,

    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sp_supplier ON supplier_payments(supplier_id);
CREATE INDEX idx_sp_status ON supplier_payments(status);
CREATE INDEX idx_sp_date ON supplier_payments(payment_date);

CREATE TABLE supplier_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
    supplier_invoice_id UUID NOT NULL REFERENCES supplier_invoices(id),
    amount_allocated DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(payment_id, supplier_invoice_id)
);

CREATE SEQUENCE supplier_payment_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_supplier_payment_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
        NEW.payment_number := 'PAY-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
            || '-' || LPAD(nextval('supplier_payment_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_sp_number
    BEFORE INSERT ON supplier_payments
    FOR EACH ROW EXECUTE FUNCTION generate_supplier_payment_number();

-- Update supplier_invoice amount_paid when payment allocation changes
CREATE OR REPLACE FUNCTION update_si_amount_paid()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE supplier_invoices
    SET amount_paid = (
        SELECT COALESCE(SUM(amount_allocated), 0)
        FROM supplier_payment_allocations
        WHERE supplier_invoice_id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id)
    ),
    status = CASE
        WHEN (SELECT COALESCE(SUM(amount_allocated), 0)
              FROM supplier_payment_allocations
              WHERE supplier_invoice_id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id)
        ) >= total_amount THEN 'paid'::supplier_invoice_status
        WHEN (SELECT COALESCE(SUM(amount_allocated), 0)
              FROM supplier_payment_allocations
              WHERE supplier_invoice_id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id)
        ) > 0 THEN 'partially_paid'::supplier_invoice_status
        ELSE status
    END,
    updated_at = NOW()
    WHERE id = COALESCE(NEW.supplier_invoice_id, OLD.supplier_invoice_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_spa_update_si
    AFTER INSERT OR UPDATE OR DELETE ON supplier_payment_allocations
    FOR EACH ROW EXECUTE FUNCTION update_si_amount_paid();
```

#### 5.1.3 Migration 202: AR Enhancements

```sql
-- ============================================================
-- Migration 202: AR Enhancements
-- Customer Payments, Credit Notes
-- ============================================================

CREATE TYPE credit_note_type AS ENUM ('customer', 'supplier');
CREATE TYPE credit_note_status AS ENUM ('draft', 'approved', 'applied', 'cancelled');

-- Add GL link to existing customer_invoices
ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS gl_journal_entry_id UUID;

-- ── Customer Payments ──────────────────────────────────────

CREATE TABLE customer_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_number VARCHAR(20) NOT NULL UNIQUE,
    client_id UUID NOT NULL,
    payment_date DATE NOT NULL,

    total_amount DECIMAL(15,2) NOT NULL,
    payment_method payment_method NOT NULL DEFAULT 'eft',
    bank_account_id UUID REFERENCES gl_accounts(id),

    reference VARCHAR(255),
    description TEXT,

    status payment_status DEFAULT 'draft',
    gl_journal_entry_id UUID REFERENCES gl_journal_entries(id),

    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE customer_payment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES customer_payments(id) ON DELETE CASCADE,
    customer_invoice_id UUID NOT NULL,
    amount_allocated DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(payment_id, customer_invoice_id)
);

CREATE SEQUENCE customer_payment_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_customer_payment_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
        NEW.payment_number := 'REC-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
            || '-' || LPAD(nextval('customer_payment_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_cp_number
    BEFORE INSERT ON customer_payments
    FOR EACH ROW EXECUTE FUNCTION generate_customer_payment_number();

-- ── Credit Notes ───────────────────────────────────────────

CREATE TABLE credit_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_number VARCHAR(20) NOT NULL UNIQUE,
    type credit_note_type NOT NULL,

    -- Customer credit note fields
    customer_invoice_id UUID,
    client_id UUID,
    -- Supplier credit note fields
    supplier_invoice_id UUID REFERENCES supplier_invoices(id),
    supplier_id UUID,

    reason TEXT NOT NULL,
    subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 15,
    tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,

    status credit_note_status DEFAULT 'draft',
    gl_journal_entry_id UUID REFERENCES gl_journal_entries(id),

    project_id UUID,
    created_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE credit_note_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity DECIMAL(12,4) NOT NULL DEFAULT 1,
    unit_price DECIMAL(15,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    line_total DECIMAL(15,2) NOT NULL DEFAULT 0,
    gl_account_id UUID REFERENCES gl_accounts(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE SEQUENCE credit_note_seq START WITH 1;

CREATE OR REPLACE FUNCTION generate_credit_note_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.credit_note_number IS NULL OR NEW.credit_note_number = '' THEN
        NEW.credit_note_number := 'CN-' || EXTRACT(YEAR FROM CURRENT_DATE)::TEXT
            || '-' || LPAD(nextval('credit_note_seq')::TEXT, 5, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_cn_number
    BEFORE INSERT ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION generate_credit_note_number();
```

#### 5.1.4 Migration 203: Bank Reconciliation

```sql
-- ============================================================
-- Migration 203: Bank Reconciliation
-- Bank Transactions, Reconciliation Sessions
-- ============================================================

CREATE TYPE bank_tx_status AS ENUM ('imported', 'matched', 'reconciled', 'excluded');
CREATE TYPE bank_recon_status AS ENUM ('in_progress', 'completed');

CREATE TABLE bank_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID NOT NULL REFERENCES gl_accounts(id),
    transaction_date DATE NOT NULL,
    value_date DATE,

    amount DECIMAL(15,2) NOT NULL,
    description TEXT,
    reference VARCHAR(255),
    bank_reference VARCHAR(255),

    status bank_tx_status DEFAULT 'imported',
    matched_journal_line_id UUID REFERENCES gl_journal_lines(id),
    reconciliation_id UUID,
    import_batch_id UUID,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_bt_account ON bank_transactions(bank_account_id);
CREATE INDEX idx_bt_date ON bank_transactions(transaction_date);
CREATE INDEX idx_bt_status ON bank_transactions(status);
CREATE INDEX idx_bt_reference ON bank_transactions(reference);
CREATE INDEX idx_bt_batch ON bank_transactions(import_batch_id);

CREATE TABLE bank_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id UUID NOT NULL REFERENCES gl_accounts(id),
    statement_date DATE NOT NULL,
    statement_balance DECIMAL(15,2) NOT NULL,

    gl_balance DECIMAL(15,2) DEFAULT 0,
    reconciled_balance DECIMAL(15,2) DEFAULT 0,
    difference DECIMAL(15,2) GENERATED ALWAYS AS (statement_balance - reconciled_balance) STORED,

    status bank_recon_status DEFAULT 'in_progress',

    started_by VARCHAR(255) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_by VARCHAR(255),
    completed_at TIMESTAMP WITH TIME ZONE,

    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_br_account ON bank_reconciliations(bank_account_id);
CREATE INDEX idx_br_date ON bank_reconciliations(statement_date);
```

#### 5.1.5 Migration 204: Financial Reporting Views

```sql
-- ============================================================
-- Migration 204: Financial Reporting Views & Functions
-- Trial Balance, P&L, Balance Sheet, Aging
-- ============================================================

-- ── Trial Balance View ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_trial_balance(
    p_as_at_date DATE DEFAULT CURRENT_DATE,
    p_project_id UUID DEFAULT NULL
)
RETURNS TABLE (
    account_id UUID,
    account_code VARCHAR(20),
    account_name VARCHAR(255),
    account_type gl_account_type,
    total_debit DECIMAL(15,2),
    total_credit DECIMAL(15,2),
    balance DECIMAL(15,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ga.id,
        ga.account_code,
        ga.account_name,
        ga.account_type,
        COALESCE(SUM(jl.debit), 0)::DECIMAL(15,2),
        COALESCE(SUM(jl.credit), 0)::DECIMAL(15,2),
        (COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0))::DECIMAL(15,2)
    FROM gl_accounts ga
    LEFT JOIN gl_journal_lines jl ON jl.gl_account_id = ga.id
    LEFT JOIN gl_journal_entries je ON je.id = jl.journal_entry_id
        AND je.status = 'posted'
        AND je.posting_date <= p_as_at_date
        AND (p_project_id IS NULL OR jl.project_id = p_project_id)
    WHERE ga.is_active = true
    GROUP BY ga.id, ga.account_code, ga.account_name, ga.account_type
    HAVING COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0
    ORDER BY ga.account_code;
END;
$$ LANGUAGE plpgsql;

-- ── AP Aging Function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ap_aging(p_as_at_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    supplier_id UUID,
    supplier_name VARCHAR(255),
    current_amount DECIMAL(15,2),
    days_30 DECIMAL(15,2),
    days_60 DECIMAL(15,2),
    days_90 DECIMAL(15,2),
    days_120_plus DECIMAL(15,2),
    total DECIMAL(15,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        si.supplier_id,
        s.name,
        SUM(CASE WHEN p_as_at_date - si.due_date <= 0 THEN si.balance ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - si.due_date BETWEEN 1 AND 30 THEN si.balance ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - si.due_date BETWEEN 31 AND 60 THEN si.balance ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - si.due_date BETWEEN 61 AND 90 THEN si.balance ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - si.due_date > 90 THEN si.balance ELSE 0 END)::DECIMAL(15,2),
        SUM(si.balance)::DECIMAL(15,2)
    FROM supplier_invoices si
    JOIN suppliers s ON s.id = si.supplier_id
    WHERE si.status IN ('approved', 'partially_paid')
      AND si.balance > 0
    GROUP BY si.supplier_id, s.name
    ORDER BY SUM(si.balance) DESC;
END;
$$ LANGUAGE plpgsql;

-- ── AR Aging Function ──────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ar_aging(p_as_at_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    client_id UUID,
    client_name VARCHAR(255),
    current_amount DECIMAL(15,2),
    days_30 DECIMAL(15,2),
    days_60 DECIMAL(15,2),
    days_90 DECIMAL(15,2),
    days_120_plus DECIMAL(15,2),
    total DECIMAL(15,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        ci.client_id,
        c.name,
        SUM(CASE WHEN p_as_at_date - ci.due_date <= 0 THEN (ci.total_amount - ci.amount_paid) ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - ci.due_date BETWEEN 1 AND 30 THEN (ci.total_amount - ci.amount_paid) ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - ci.due_date BETWEEN 31 AND 60 THEN (ci.total_amount - ci.amount_paid) ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - ci.due_date BETWEEN 61 AND 90 THEN (ci.total_amount - ci.amount_paid) ELSE 0 END)::DECIMAL(15,2),
        SUM(CASE WHEN p_as_at_date - ci.due_date > 90 THEN (ci.total_amount - ci.amount_paid) ELSE 0 END)::DECIMAL(15,2),
        SUM(ci.total_amount - ci.amount_paid)::DECIMAL(15,2)
    FROM customer_invoices ci
    JOIN clients c ON c.id = ci.client_id
    WHERE ci.status IN ('sent', 'partially_paid', 'overdue')
      AND (ci.total_amount - ci.amount_paid) > 0
    GROUP BY ci.client_id, c.name
    ORDER BY SUM(ci.total_amount - ci.amount_paid) DESC;
END;
$$ LANGUAGE plpgsql;
```

### 5.2 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Chart of Accounts** | | |
| GET | `/api/accounting/chart-of-accounts` | List all accounts (tree) |
| POST | `/api/accounting/chart-of-accounts` | Create account |
| GET | `/api/accounting/chart-of-accounts/[id]` | Account detail + balance |
| PUT | `/api/accounting/chart-of-accounts/[id]` | Update account |
| DELETE | `/api/accounting/chart-of-accounts/[id]` | Deactivate (if no transactions) |
| **Journal Entries** | | |
| GET | `/api/accounting/journal-entries` | List (filterable by period, project, status) |
| POST | `/api/accounting/journal-entries` | Create draft entry |
| GET | `/api/accounting/journal-entries/[id]` | Entry detail with lines |
| PUT | `/api/accounting/journal-entries/[id]` | Update draft entry |
| POST | `/api/accounting/journal-entries/[id]/post` | Post entry (validates balance) |
| POST | `/api/accounting/journal-entries/[id]/reverse` | Create reversing entry |
| **Fiscal Periods** | | |
| GET | `/api/accounting/fiscal-periods` | List periods |
| POST | `/api/accounting/fiscal-periods` | Create fiscal year (12 periods) |
| POST | `/api/accounting/fiscal-periods/[id]/close` | Close period |
| POST | `/api/accounting/fiscal-periods/[id]/lock` | Lock period (permanent) |
| **Supplier Invoices** | | |
| GET | `/api/accounting/supplier-invoices` | List (filterable) |
| POST | `/api/accounting/supplier-invoices` | Create with items |
| GET | `/api/accounting/supplier-invoices/[id]` | Detail with items + match info |
| PUT | `/api/accounting/supplier-invoices/[id]` | Update draft |
| POST | `/api/accounting/supplier-invoices/[id]/approve` | Approve + auto-post GL |
| POST | `/api/accounting/supplier-invoices/[id]/match` | Match to PO/GRN |
| **Supplier Payments** | | |
| GET | `/api/accounting/supplier-payments` | List |
| POST | `/api/accounting/supplier-payments` | Create with allocations |
| POST | `/api/accounting/supplier-payments/[id]/approve` | Approve |
| POST | `/api/accounting/supplier-payments/[id]/process` | Process + auto-post GL |
| POST | `/api/accounting/supplier-payments/batch` | Create payment run |
| **Customer Payments** | | |
| GET | `/api/accounting/customer-payments` | List |
| POST | `/api/accounting/customer-payments` | Create with allocations |
| POST | `/api/accounting/customer-payments/[id]/process` | Process + auto-post GL |
| **Credit Notes** | | |
| GET | `/api/accounting/credit-notes` | List |
| POST | `/api/accounting/credit-notes` | Create |
| POST | `/api/accounting/credit-notes/[id]/approve` | Approve + auto-post GL |
| **Bank Reconciliation** | | |
| POST | `/api/accounting/bank-transactions/import` | Import CSV statement |
| GET | `/api/accounting/bank-transactions` | List (filterable by account, status) |
| POST | `/api/accounting/bank-transactions/[id]/match` | Match to GL line |
| POST | `/api/accounting/bank-transactions/[id]/unmatch` | Unmatch |
| GET | `/api/accounting/bank-reconciliations` | List reconciliation sessions |
| POST | `/api/accounting/bank-reconciliations` | Start new reconciliation |
| POST | `/api/accounting/bank-reconciliations/[id]/complete` | Complete (validates diff=0) |
| **Reports** | | |
| GET | `/api/accounting/reports/trial-balance` | Trial balance |
| GET | `/api/accounting/reports/income-statement` | P&L |
| GET | `/api/accounting/reports/balance-sheet` | Balance sheet |
| GET | `/api/accounting/reports/cash-flow` | Cash flow statement |
| GET | `/api/accounting/reports/ap-aging` | AP aging |
| GET | `/api/accounting/reports/ar-aging` | AR aging |
| GET | `/api/accounting/reports/vat-return` | VAT return |
| GET | `/api/accounting/reports/project-profitability` | Project P&L |

### 5.3 Auto-Posting Hooks

These are service functions called from existing API endpoints when status changes occur:

```typescript
// src/modules/accounting/services/autoPostingService.ts

// Called from: /api/projects/[projectId]/customer-invoices/[id] PUT status→approved
postCustomerInvoice(invoice): JournalEntry
  DR 1200 Accounts Receivable   = invoice.totalAmount
  CR 4100 Revenue               = invoice.subtotal
  CR 2120 VAT Output            = invoice.taxAmount

// Called from: /api/accounting/customer-payments/[id]/process
postCustomerPayment(payment): JournalEntry
  DR 1110 Bank                  = payment.totalAmount
  CR 1200 Accounts Receivable   = payment.totalAmount

// Called from: /api/procurement/grn/[id] PUT status→completed
postGRNCompletion(grn, poItems): JournalEntry
  DR 5100 Materials (or mapped) = grn.subtotal
  DR 1400 VAT Input             = grn.taxAmount
  CR 2110 Accounts Payable      = grn.totalAmount

// Called from: /api/accounting/supplier-payments/[id]/process
postSupplierPayment(payment): JournalEntry
  DR 2110 Accounts Payable      = payment.totalAmount
  CR 1110 Bank                  = payment.totalAmount

// Called from: /api/procurement/field-stock/pickings/[id]/process
postStockConsumption(picking): JournalEntry
  DR 5100 Cost of Sales         = picking.totalCost
  CR 1300 Inventory             = picking.totalCost

// Called from: /api/accounting/credit-notes/[id]/approve
postCreditNote(creditNote): JournalEntry
  // Reverses original entry based on type (customer/supplier)
```

---

## 6. User Interface

### 6.1 Accounting Dashboard (`/accounting`)
```
┌─────────────────────────────────────────────────────────────┐
│ Accounting Dashboard                                         │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ Cash Position│ AP Outstanding│ AR Outstanding│ Net Position   │
│   R 1,234,567│   R 456,789  │   R 789,012  │  R 1,566,790  │
│   ▲ 12.3%   │   ▼ 5.1%    │   ▲ 8.7%    │   ▲ 15.2%     │
├──────────────┴──────────────┴──────────────┴────────────────┤
│ Quick Actions                                                │
│ [+ Journal Entry] [+ Supplier Invoice] [Record Payment]     │
│ [Bank Reconciliation] [Run Reports]                          │
├─────────────────────────────────┬───────────────────────────┤
│ Recent Journal Entries          │ Overdue Invoices           │
│ JE-2026-00145  Manual  Posted  │ INV-2026-00089  R 45,000  │
│ JE-2026-00144  Invoice Posted  │ INV-2026-00076  R 23,400  │
│ JE-2026-00143  Payment Posted  │ INV-2026-00071  R 12,800  │
│ [View All →]                   │ [View All →]               │
└─────────────────────────────────┴───────────────────────────┘
```

### 6.2 Chart of Accounts (`/accounting/chart-of-accounts`)
```
┌─────────────────────────────────────────────────────────────┐
│ Chart of Accounts                          [+ Add Account]   │
├─────┬────────────────────────────┬──────┬──────┬────────────┤
│ Code│ Account Name               │ Type │Balance│ Status     │
├─────┼────────────────────────────┼──────┼──────┼────────────┤
│ 1000│ ▼ Assets                   │      │      │            │
│ 1100│   ▼ Current Assets         │      │      │            │
│ 1110│     Bank - FNB Current     │ Bank │ 1.2M │ ● Active   │
│ 1120│     Bank - FNB Savings     │ Bank │ 340K │ ● Active   │
│ 1200│     Accounts Receivable    │ AR   │ 789K │ ● System   │
│ 1300│     Inventory              │ Inv  │ 234K │ ● System   │
│ 1400│     VAT Input              │ Tax  │  56K │ ● System   │
│ 2000│ ▼ Liabilities              │      │      │            │
│ 2110│     Accounts Payable       │ AP   │ 456K │ ● System   │
│ 2120│     VAT Output             │ Tax  │  89K │ ● System   │
│ ...                                                          │
└─────────────────────────────────────────────────────────────┘
```

### 6.3 Bank Reconciliation (`/accounting/bank-reconciliation`)
```
┌─────────────────────────────────────────────────────────────┐
│ Bank Reconciliation — FNB Current (1110)                     │
│ Statement Date: 2026-02-28  Balance: R 1,234,567.89         │
├─────────────────────────────────┬───────────────────────────┤
│ Bank Statement Lines            │ GL Entries (Unreconciled)  │
│ ┌───────────────────────────┐  │ ┌───────────────────────┐ │
│ │ 2026-02-25  EFT IN  45000│→ │ │ REC-2026-00023  45000 │ │
│ │ 2026-02-24  EFT OUT 12000│→ │ │ PAY-2026-00089  12000 │ │
│ │ 2026-02-23  BANK FEE  156│  │ │                       │ │
│ │ 2026-02-22  EFT IN  23400│  │ │ REC-2026-00022  23400 │ │
│ └───────────────────────────┘  │ └───────────────────────┘ │
├─────────────────────────────────┴───────────────────────────┤
│ Matched: 3     Unmatched: 1     Difference: R 156.00        │
│ [Auto-Match] [Create Adjustment for R 156.00] [Complete]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Testing Requirements

### 7.1 Unit Tests
- [ ] Double-entry validation: debit = credit enforcement
- [ ] Journal entry number generation
- [ ] Fiscal period date validation
- [ ] AP/AR aging bucket calculations
- [ ] 3-way match validation logic
- [ ] Credit note amount calculations
- [ ] Bank CSV parsing (FNB, Standard Bank, Nedbank formats)
- [ ] Bank auto-match algorithm
- [ ] Trial balance calculation
- [ ] P&L grouping logic

### 7.2 Integration Tests (API)
- [ ] Chart of accounts CRUD
- [ ] Journal entry create → post → verify GL
- [ ] Fiscal period close blocks further posting
- [ ] Supplier invoice create → approve → GL auto-post
- [ ] Supplier payment with allocation → GL auto-post
- [ ] Customer payment with allocation → GL auto-post
- [ ] Credit note approve → GL reversal
- [ ] Bank transaction import → auto-match
- [ ] Bank reconciliation complete (difference must be 0)
- [ ] Trial balance endpoint returns balanced data
- [ ] Income statement filters by project and period

### 7.3 E2E Tests (Browser)
- [ ] Accounting dashboard loads with financial summary
- [ ] Chart of accounts displays tree, create/edit/deactivate accounts
- [ ] Create manual journal entry, post it, verify in GL
- [ ] Create supplier invoice, match to PO, approve
- [ ] Create supplier payment run, process batch
- [ ] Record customer payment, allocate to invoices
- [ ] Import bank statement CSV, auto-match, complete reconciliation
- [ ] Generate and view Trial Balance report
- [ ] Generate and view P&L report (filter by project)
- [ ] Generate and view Balance Sheet report
- [ ] AP/AR aging reports display correctly

### 7.4 Coverage Target
- **Unit tests**: >= 80% line coverage
- **Integration tests**: All API endpoints have at least one happy-path and one error-path test
- **E2E tests**: All critical user flows from Section 2

---

## 8. Implementation Plan

### Phase 1: Foundation (Weeks 1-5)
- Migration 200: GL accounts, journal entries, fiscal periods
- `/api/accounting/chart-of-accounts` CRUD
- `/api/accounting/journal-entries` CRUD + post + reverse
- `/api/accounting/fiscal-periods` CRUD + close
- Auto-posting service (framework, not yet hooked)
- UI: Chart of accounts page, journal entry page
- TDD: Unit tests for double-entry engine, integration tests for GL APIs

### Phase 2: Accounts Payable (Weeks 6-9)
- Migration 201: Supplier invoices, payments, allocations
- `/api/accounting/supplier-invoices` CRUD + approve + match
- `/api/accounting/supplier-payments` CRUD + process + batch
- Hook auto-posting into GRN completion
- UI: Supplier invoice pages, payment run page
- TDD: 3-way matching tests, payment allocation tests

### Phase 3: AR Enhancements (Weeks 10-12)
- Migration 202: Customer payments, credit notes
- `/api/accounting/customer-payments` CRUD + process
- `/api/accounting/credit-notes` CRUD + approve
- Hook auto-posting into customer invoice approval and payment
- UI: Customer payment pages, credit note pages
- TDD: AR aging tests, credit note reversal tests

### Phase 4: Bank Reconciliation (Weeks 13-15)
- Migration 203: Bank transactions, reconciliations
- `/api/accounting/bank-transactions` import + match
- `/api/accounting/bank-reconciliations` CRUD + complete
- CSV parsers for FNB, Standard Bank, Nedbank
- UI: Bank reconciliation page
- TDD: CSV parser tests, auto-match tests, reconciliation tests

### Phase 5: Financial Reporting (Weeks 16-18)
- Migration 204: Reporting views and functions
- Report endpoints: trial-balance, income-statement, balance-sheet, cash-flow, vat-return, aging, project-profitability
- UI: Reports page with filters and export
- TDD: Report calculation tests, export tests

### Phase 6: Sage Migration (Weeks 19-21)
- Import sage_accounts → gl_accounts mapping
- Import sage_ledger_transactions → gl_journal_entries
- Import sage_supplier_invoices → supplier_invoices
- Parallel run: both systems active, compare reports
- Accountant sign-off gate
- Decommission Sage sync (keep as backup)

---

## 9. File Structure

```
src/modules/accounting/
├── types/
│   ├── gl.types.ts
│   ├── ap.types.ts
│   ├── ar.types.ts
│   ├── bank.types.ts
│   └── reports.types.ts
├── services/
│   ├── glService.ts           # Journal entry CRUD + posting
│   ├── chartOfAccountsService.ts
│   ├── fiscalPeriodService.ts
│   ├── autoPostingService.ts  # Auto-post hooks
│   ├── apService.ts           # Supplier invoices + matching
│   ├── paymentService.ts      # Supplier + customer payments
│   ├── creditNoteService.ts
│   ├── bankReconciliationService.ts
│   ├── bankCsvParsers.ts      # FNB, Standard Bank, Nedbank
│   └── reportingService.ts    # All financial reports
├── components/
│   ├── AccountingDashboard.tsx
│   ├── ChartOfAccounts/
│   ├── JournalEntries/
│   ├── SupplierInvoices/
│   ├── PaymentRuns/
│   ├── CustomerPayments/
│   ├── CreditNotes/
│   ├── BankReconciliation/
│   └── Reports/
├── hooks/
│   ├── useChartOfAccounts.ts
│   ├── useJournalEntries.ts
│   ├── useSupplierInvoices.ts
│   ├── usePayments.ts
│   ├── useBankReconciliation.ts
│   └── useReports.ts
└── utils/
    ├── doubleEntry.ts         # Validation helpers
    ├── aging.ts               # Aging bucket calculations
    └── bankCsvFormats.ts      # Bank format definitions

pages/api/accounting/
├── chart-of-accounts/
│   ├── index.ts
│   └── [id].ts
├── journal-entries/
│   ├── index.ts
│   ├── [id].ts
│   ├── [id]/post.ts
│   └── [id]/reverse.ts
├── fiscal-periods/
│   ├── index.ts
│   └── [id]/close.ts
├── supplier-invoices/
│   ├── index.ts
│   ├── [id].ts
│   ├── [id]/approve.ts
│   └── [id]/match.ts
├── supplier-payments/
│   ├── index.ts
│   ├── [id]/approve.ts
│   ├── [id]/process.ts
│   └── batch.ts
├── customer-payments/
│   ├── index.ts
│   └── [id]/process.ts
├── credit-notes/
│   ├── index.ts
│   └── [id]/approve.ts
├── bank-transactions/
│   ├── import.ts
│   ├── index.ts
│   └── [id]/match.ts
├── bank-reconciliations/
│   ├── index.ts
│   └── [id]/complete.ts
└── reports/
    ├── trial-balance.ts
    ├── income-statement.ts
    ├── balance-sheet.ts
    ├── cash-flow.ts
    ├── ap-aging.ts
    ├── ar-aging.ts
    ├── vat-return.ts
    └── project-profitability.ts

pages/accounting/
├── index.tsx                  # Dashboard
├── chart-of-accounts.tsx
├── journal-entries/
│   ├── index.tsx
│   ├── new.tsx
│   └── [id].tsx
├── supplier-invoices/
│   ├── index.tsx
│   ├── new.tsx
│   └── [id].tsx
├── supplier-payments/
│   ├── index.tsx
│   └── new.tsx
├── customer-payments/
│   ├── index.tsx
│   └── new.tsx
├── credit-notes/
│   ├── index.tsx
│   └── new.tsx
├── bank-reconciliation/
│   ├── index.tsx
│   └── [id].tsx
└── reports/
    ├── index.tsx
    ├── trial-balance.tsx
    ├── income-statement.tsx
    ├── balance-sheet.tsx
    └── project-profitability.tsx

scripts/migrations/
├── 200_accounting_foundation.sql
├── 201_accounts_payable.sql
├── 202_ar_enhancements.sql
├── 203_bank_reconciliation.sql
└── 204_financial_reporting.sql
```

---

## 10. Dependencies

- **PRD-050**: Procurement Portal (purchase_orders, suppliers, grn tables)
- **PRD-057**: Project Budget Tracking (budget_transactions, budget_categories)
- **Migration 149**: Customer invoicing (customer_invoices, client_purchase_orders)
- **Migration 070**: Sage integration (sage_accounts, sage_supplier_invoices — migration source)
- **Migration 105**: Cost centers (cost_center_allocations)
- **Existing modules**: Procurement, projects, clients, suppliers

---

## 11. Out of Scope

- Multi-currency accounting (ZAR only for now)
- Fixed asset depreciation scheduling (manual journal entries supported)
- Payroll processing (PAYE, UIF, SDL — separate future PRD)
- Contractor claim management (deferred to PRD-061)
- Intercompany transactions
- Audit firm integration (data export for external auditors — future)
- Budget forecasting/projections
- Automated tax filing to SARS

---

## 12. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Accountant doesn't trust new system | Critical | Medium | Phase 6 parallel run with report comparison |
| Double-entry bugs cause imbalanced ledger | Critical | Low | DB trigger enforcement + unit tests |
| Sage migration data loss | High | Low | Keep Sage running during migration, import is additive |
| Performance degradation with large GL | Medium | Low | Indexed queries, materialized views for reports |
| Bank CSV format changes | Low | Medium | Parser per bank, configurable column mapping |
| Fiscal period misalignment with Sage | Medium | Medium | Align fiscal year start before migration |
| Scope creep into payroll/HR | Medium | High | Strict out-of-scope boundary, separate PRD |

---

## 13. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Owner | | | |
| Tech Lead | | | |
| Finance Manager | | | |
| Accountant | | | |
