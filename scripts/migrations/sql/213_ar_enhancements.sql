/**
 * Migration 213: AR Enhancements
 * - Credit note line items table
 * - Cancel support for payments and credit notes
 */

-- Credit note line items
CREATE TABLE IF NOT EXISTS credit_note_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(5,2) DEFAULT 15.00,
  tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(15,2) NOT NULL DEFAULT 0,
  gl_account_id UUID REFERENCES gl_accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cni_credit_note ON credit_note_items(credit_note_id);

-- Cancel support for customer payments
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- Cancel support for credit notes
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
