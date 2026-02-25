-- Migration 205: Sage Migration Infrastructure
-- PRD-060: FibreFlow Accounting Module - Phase 6
-- Account mapping, migration tracking, link columns

-- ── Migration Runs Tracking ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_migration_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_type VARCHAR(50) NOT NULL,  -- 'account_mapping', 'ledger_import', 'invoice_import'
    status VARCHAR(20) NOT NULL DEFAULT 'running',  -- 'running', 'completed', 'failed', 'partial'
    total_records INTEGER DEFAULT 0,
    processed INTEGER DEFAULT 0,
    succeeded INTEGER DEFAULT 0,
    failed INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    details JSONB DEFAULT '{}',
    error_message TEXT,
    started_by VARCHAR(255),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_migration_runs_type ON gl_migration_runs(run_type);
CREATE INDEX idx_migration_runs_status ON gl_migration_runs(status);

-- ── Link sage_accounts to gl_accounts ───────────────────────────────────────
ALTER TABLE sage_accounts ADD COLUMN IF NOT EXISTS gl_account_id UUID REFERENCES gl_accounts(id);
ALTER TABLE sage_accounts ADD COLUMN IF NOT EXISTS mapping_status VARCHAR(20) DEFAULT 'unmapped';
ALTER TABLE sage_accounts ADD COLUMN IF NOT EXISTS mapping_notes TEXT;

-- ── Link sage_ledger_transactions to journal entries ────────────────────────
ALTER TABLE sage_ledger_transactions ADD COLUMN IF NOT EXISTS gl_journal_entry_id UUID REFERENCES gl_journal_entries(id);
ALTER TABLE sage_ledger_transactions ADD COLUMN IF NOT EXISTS migration_status VARCHAR(20) DEFAULT 'pending';

-- ── Link sage_supplier_invoices to new supplier_invoices ────────────────────
ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS gl_supplier_invoice_id UUID REFERENCES supplier_invoices(id);
ALTER TABLE sage_supplier_invoices ADD COLUMN IF NOT EXISTS migration_status VARCHAR(20) DEFAULT 'pending';

-- ── Migration comparison snapshots ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gl_migration_comparisons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comparison_date DATE NOT NULL DEFAULT CURRENT_DATE,
    sage_totals JSONB NOT NULL DEFAULT '{}',
    gl_totals JSONB NOT NULL DEFAULT '{}',
    differences JSONB NOT NULL DEFAULT '{}',
    is_balanced BOOLEAN DEFAULT false,
    notes TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
