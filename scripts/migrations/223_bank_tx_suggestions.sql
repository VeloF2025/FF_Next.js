-- Migration 223: Add suggestion columns to bank_transactions
-- Populated by categorisation rules or classified import; never by users directly.

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_gl_account_id UUID REFERENCES gl_accounts(id),
  ADD COLUMN IF NOT EXISTS suggested_supplier_id INTEGER REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS suggested_category VARCHAR(100),
  ADD COLUMN IF NOT EXISTS suggested_cost_centre VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_bank_tx_suggested_gl
  ON bank_transactions(suggested_gl_account_id)
  WHERE suggested_gl_account_id IS NOT NULL;
