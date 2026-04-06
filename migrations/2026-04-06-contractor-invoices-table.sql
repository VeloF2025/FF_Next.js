-- Migration: Create contractor_invoices table for IMS Phase B
-- Date: 2026-04-06
-- Author: Flow
-- Description: Tracks invoice and progress claims submitted by contractors,
--              with full lifecycle status transitions and JSONB line items.

-- Enum for invoice status
CREATE TYPE contractor_invoice_status AS ENUM (
  'submitted',
  'under_review',
  'approved',
  'paid',
  'rejected'
);

CREATE TABLE IF NOT EXISTS contractor_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  contractor_project_id INTEGER REFERENCES contractor_projects(id) ON DELETE SET NULL,

  -- Invoice identification
  invoice_number VARCHAR(100) NOT NULL,

  -- Status
  status contractor_invoice_status NOT NULL DEFAULT 'submitted',

  -- Line items: array of {description, quantity, unit_price, amount}
  line_items JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- Financials
  total_amount NUMERIC(14, 2) NOT NULL CHECK (total_amount >= 0),

  -- Rejection reason (required when status = 'rejected')
  rejection_reason TEXT,

  -- General notes
  notes TEXT,

  -- Audit
  created_by UUID REFERENCES users(id),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Uniqueness constraint: one invoice number per contractor
  CONSTRAINT uq_contractor_invoice_number UNIQUE (contractor_id, invoice_number)
);

-- Indexes for performance
CREATE INDEX idx_contractor_invoices_contractor_id ON contractor_invoices(contractor_id);
CREATE INDEX idx_contractor_invoices_contractor_project_id ON contractor_invoices(contractor_project_id);
CREATE INDEX idx_contractor_invoices_status ON contractor_invoices(status);
CREATE INDEX idx_contractor_invoices_created_at ON contractor_invoices(created_at DESC);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_contractor_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contractor_invoices_updated_at
  BEFORE UPDATE ON contractor_invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_contractor_invoices_updated_at();

-- Comments for documentation
COMMENT ON TABLE contractor_invoices IS 'Invoices and progress claims submitted by contractors; full lifecycle from submitted to paid/rejected';
COMMENT ON COLUMN contractor_invoices.invoice_number IS 'Contractor-supplied invoice reference number, unique per contractor';
COMMENT ON COLUMN contractor_invoices.line_items IS 'JSONB array of {description: string, quantity: number, unit_price: number, amount: number}';
COMMENT ON COLUMN contractor_invoices.total_amount IS 'Sum of all line item amounts, in ZAR';
COMMENT ON COLUMN contractor_invoices.rejection_reason IS 'Required when status transitions to rejected';
COMMENT ON COLUMN contractor_invoices.created_by IS 'User who created the invoice record';
