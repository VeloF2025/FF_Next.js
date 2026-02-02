-- Migration 151: Client PO Documents and PDF Import Support
-- Adds document storage for Client POs and project documents (BSS, MSS)

-- Add document fields to client_purchase_orders for PDF import tracking
ALTER TABLE client_purchase_orders ADD COLUMN IF NOT EXISTS source_document_url VARCHAR(500);
ALTER TABLE client_purchase_orders ADD COLUMN IF NOT EXISTS source_document_name VARCHAR(255);
ALTER TABLE client_purchase_orders ADD COLUMN IF NOT EXISTS vlm_extraction_data JSONB;
ALTER TABLE client_purchase_orders ADD COLUMN IF NOT EXISTS vlm_confidence_score DECIMAL(3,2);

-- New project_documents table for BSS, MSS, and other project docs
CREATE TABLE IF NOT EXISTS project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
    'bss', 'mss', 'contract', 'amendment', 'wayleave', 'permit', 'other'
  )),
  document_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_path VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(100),
  description TEXT,
  version VARCHAR(50),
  effective_date DATE,
  expiry_date DATE,
  client_po_id UUID REFERENCES client_purchase_orders(id) ON DELETE SET NULL,
  uploaded_by VARCHAR(255) NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for project_documents
CREATE INDEX IF NOT EXISTS idx_project_docs_project ON project_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_project_docs_type ON project_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_project_docs_client_po ON project_documents(client_po_id);

-- One active BSS/MSS per project (constraint)
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_docs_unique_active
  ON project_documents(project_id, document_type)
  WHERE document_type IN ('bss', 'mss') AND is_active = true;

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_project_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_documents_updated_at ON project_documents;
CREATE TRIGGER project_documents_updated_at
  BEFORE UPDATE ON project_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_project_documents_updated_at();

-- Comment on table and columns
COMMENT ON TABLE project_documents IS 'Project documents including BSS, MSS, contracts, and other related files';
COMMENT ON COLUMN project_documents.document_type IS 'Type: bss (Build Service Schedule), mss (Maintenance Service Schedule), contract, amendment, wayleave, permit, other';
COMMENT ON COLUMN project_documents.client_po_id IS 'Optional link to a specific Client PO - BSS/MSS often tied to a PO';
COMMENT ON COLUMN project_documents.is_active IS 'Soft delete flag - only one active BSS/MSS per project';
COMMENT ON COLUMN client_purchase_orders.source_document_url IS 'URL to the uploaded PO PDF in VF Storage';
COMMENT ON COLUMN client_purchase_orders.vlm_extraction_data IS 'Raw JSON data extracted by VLM from the PO PDF';
COMMENT ON COLUMN client_purchase_orders.vlm_confidence_score IS 'VLM extraction confidence 0.00-1.00';
