-- Migration: Create contractor_progress_claims table for IMS Phase B Feature 2
-- Date: 2026-04-06
-- Description: Tracks progress claims submitted by contractors against project assignments.

CREATE TABLE IF NOT EXISTS contractor_progress_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  contractor_project_id INTEGER REFERENCES contractor_projects(id) ON DELETE SET NULL,
  claim_number INTEGER NOT NULL,
  claim_date DATE NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  description TEXT NOT NULL,
  amount_claimed NUMERIC(14, 2) NOT NULL CHECK (amount_claimed >= 0),
  amount_approved NUMERIC(14, 2) CHECK (amount_approved >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'invoiced')),
  submitted_by UUID REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  invoice_id UUID REFERENCES contractor_invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_contractor_claim_number UNIQUE (contractor_id, claim_number)
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_contractor_progress_claims_contractor_id
  ON contractor_progress_claims(contractor_id);

CREATE INDEX IF NOT EXISTS idx_contractor_progress_claims_status
  ON contractor_progress_claims(status);

CREATE INDEX IF NOT EXISTS idx_contractor_progress_claims_created_at
  ON contractor_progress_claims(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contractor_progress_claims_invoice_id
  ON contractor_progress_claims(invoice_id);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_contractor_progress_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contractor_progress_claims_updated_at
  BEFORE UPDATE ON contractor_progress_claims
  FOR EACH ROW
  EXECUTE FUNCTION update_contractor_progress_claims_updated_at();
