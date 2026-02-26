-- Migration 212: Banking enhancements — import batches, attachments, cross-module links
-- Supports: Statement balance widget, attachments, PO/Fleet/Asset matching

-- ── Import Batches (Statement Balance Widget) ──────────────────────────────
CREATE TABLE IF NOT EXISTS bank_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  statement_date DATE NOT NULL,
  bank_format VARCHAR(30),
  opening_balance NUMERIC(15,2),
  closing_balance NUMERIC(15,2),
  transaction_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS running_balance NUMERIC(15,2);

-- ── Attachments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_transaction_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bta_tx ON bank_transaction_attachments(bank_transaction_id);

-- ── Cross-module links on bank_transactions ────────────────────────────────
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS linked_po_id UUID,
  ADD COLUMN IF NOT EXISTS linked_fleet_fuel_id UUID,
  ADD COLUMN IF NOT EXISTS linked_fleet_service_id UUID,
  ADD COLUMN IF NOT EXISTS linked_asset_id UUID;

-- ── Reverse links on other tables ──────────────────────────────────────────
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

ALTER TABLE fleet_fuel_transactions
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

ALTER TABLE fleet_service_history
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID;

ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS bank_transaction_id UUID,
  ADD COLUMN IF NOT EXISTS purchase_journal_entry_id UUID;
