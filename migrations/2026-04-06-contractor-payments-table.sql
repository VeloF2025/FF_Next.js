-- Migration: Create contractor_payments table for IMS Phase B
-- Date: 2026-04-06
-- Author: Flow
-- Description: Tracks payments made to contractors per project assignment

CREATE TABLE IF NOT EXISTS contractor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  contractor_project_id INTEGER REFERENCES contractor_projects(id) ON DELETE SET NULL,

  -- Payment details
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  reference VARCHAR(255),
  notes TEXT,

  -- Audit
  recorded_by UUID REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_contractor_payments_contractor_id ON contractor_payments(contractor_id);
CREATE INDEX idx_contractor_payments_contractor_project_id ON contractor_payments(contractor_project_id);
CREATE INDEX idx_contractor_payments_payment_date ON contractor_payments(payment_date);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_contractor_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contractor_payments_updated_at
  BEFORE UPDATE ON contractor_payments
  FOR EACH ROW
  EXECUTE FUNCTION update_contractor_payments_updated_at();

-- Comments for documentation
COMMENT ON TABLE contractor_payments IS 'Payments made to contractors, optionally linked to a project assignment';
COMMENT ON COLUMN contractor_payments.contractor_project_id IS 'Optional link to a specific contractor_projects row';
COMMENT ON COLUMN contractor_payments.amount IS 'Payment amount in ZAR (Rand)';
COMMENT ON COLUMN contractor_payments.reference IS 'Bank reference or invoice number';
