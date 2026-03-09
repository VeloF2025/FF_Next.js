-- Migration 226: Document Cross-Validation (PO vs BSS vs MSS)
-- Adds VLM extraction data to project_documents and cross-validation results

-- Add extraction columns to project_documents (matching client_purchase_orders pattern)
ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS vlm_extraction_data JSONB,
  ADD COLUMN IF NOT EXISTS vlm_confidence_score DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(20) DEFAULT NULL;
-- extraction_status: null (not extracted), 'pending', 'success', 'failed'

-- Cross-validation results table
CREATE TABLE IF NOT EXISTS document_cross_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_po_id UUID REFERENCES client_purchase_orders(id) ON DELETE SET NULL,

  -- Document references
  po_document_url TEXT,
  bss_document_id UUID REFERENCES project_documents(id) ON DELETE SET NULL,
  mss_document_id UUID REFERENCES project_documents(id) ON DELETE SET NULL,

  -- Extracted values for comparison
  po_drops INTEGER,
  po_price_per_drop DECIMAL(12,2),
  po_total_value DECIMAL(14,2),
  bss_drops INTEGER,
  bss_price_per_drop DECIMAL(12,2),
  bss_total_value DECIMAL(14,2),
  mss_drops INTEGER,
  mss_price_per_drop DECIMAL(12,2),
  mss_total_value DECIMAL(14,2),

  -- Validation result
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- status: 'pending', 'passed', 'failed', 'warning'
  is_valid BOOLEAN DEFAULT FALSE,
  discrepancies JSONB DEFAULT '[]',
  -- e.g. [{"field": "drops", "po": 13756, "bss": 12000, "severity": "error"}]

  confidence_score DECIMAL(3,2),
  validated_at TIMESTAMPTZ,
  validated_by VARCHAR(100) DEFAULT 'system',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast project lookup
CREATE INDEX IF NOT EXISTS idx_doc_cross_val_project ON document_cross_validations(project_id);

-- Only one active validation per project (latest wins)
CREATE INDEX IF NOT EXISTS idx_doc_cross_val_latest ON document_cross_validations(project_id, created_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_doc_cross_val_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_doc_cross_val_updated_at ON document_cross_validations;
CREATE TRIGGER trg_doc_cross_val_updated_at
  BEFORE UPDATE ON document_cross_validations
  FOR EACH ROW
  EXECUTE FUNCTION update_doc_cross_val_updated_at();
