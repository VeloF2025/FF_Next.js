-- Migration 214: Client accounting fields + dunning communications
-- Adds category, priority, payment terms, credit rating, credit limit,
-- sales rep, and account manager columns to clients table.
-- Also creates dunning_communications table for tracking collection letters.

-- Client accounting columns
ALTER TABLE clients ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'sme';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'medium';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(50) DEFAULT 'net_30';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_rating VARCHAR(50) DEFAULT 'unrated';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15,2) DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sales_representative_id UUID REFERENCES staff(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_manager_id UUID REFERENCES staff(id);

-- Dunning communications tracking
CREATE TABLE IF NOT EXISTS dunning_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'reminder',
  level INTEGER NOT NULL DEFAULT 1,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  total_overdue NUMERIC(15,2) NOT NULL DEFAULT 0,
  invoices_included UUID[] DEFAULT '{}',
  sent_via VARCHAR(20) DEFAULT 'email',
  sent_to TEXT,
  sent_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dunning_client ON dunning_communications(client_id);
CREATE INDEX IF NOT EXISTS idx_dunning_status ON dunning_communications(status);
CREATE INDEX IF NOT EXISTS idx_clients_sales_rep ON clients(sales_representative_id);
CREATE INDEX IF NOT EXISTS idx_clients_account_mgr ON clients(account_manager_id);
