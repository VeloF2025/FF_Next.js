-- Migration 232: Add client support to bank categorisation rules
-- Enables rules to set allocation type (account/supplier/customer)

-- Add client_id to categorisation rules (supplier_id already exists from migration 208)
ALTER TABLE bank_categorisation_rules
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- Add suggested client to bank transactions (suggested_supplier_id already exists from migration 223)
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS suggested_client_id UUID REFERENCES clients(id);
