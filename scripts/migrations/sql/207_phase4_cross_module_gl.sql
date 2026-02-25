-- Migration 207: Phase 4 Cross-Module GL Integration
-- Adds PO commitment accounting and asset depreciation GL hooks

-- ── PO → GL Link ──────────────────────────────────────────────────────────────

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS gl_journal_entry_id UUID REFERENCES gl_journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_po_gl_entry ON purchase_orders (gl_journal_entry_id)
  WHERE gl_journal_entry_id IS NOT NULL;

-- ── Asset → GL Link ───────────────────────────────────────────────────────────

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS gl_journal_entry_id UUID REFERENCES gl_journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_assets_gl_entry ON assets (gl_journal_entry_id)
  WHERE gl_journal_entry_id IS NOT NULL;

-- ── Depreciation Expense GL Account ───────────────────────────────────────────

INSERT INTO gl_accounts (account_code, account_name, account_type, normal_balance, level, display_order, is_system_account, parent_account_id)
VALUES (
  '5800', 'Depreciation Expense', 'expense', 'debit', 3, 580, false,
  (SELECT id FROM gl_accounts WHERE account_code = '5000')
)
ON CONFLICT (account_code) DO NOTHING;

-- ── Expand GL Source CHECK ────────────────────────────────────────────────────

ALTER TABLE gl_journal_entries
  DROP CONSTRAINT IF EXISTS gl_journal_entries_source_check;

ALTER TABLE gl_journal_entries
  ADD CONSTRAINT gl_journal_entries_source_check
  CHECK (source IN (
    'manual', 'auto_invoice', 'auto_payment', 'auto_grn',
    'auto_credit_note', 'auto_bank_recon', 'auto_supplier_invoice',
    'auto_supplier_payment', 'auto_write_off', 'auto_adjustment',
    'auto_vat_adjustment', 'auto_batch_payment', 'auto_recurring',
    'auto_purchase_order', 'auto_depreciation'
  ));
