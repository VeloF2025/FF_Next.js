-- Migration 187: Procurement Documents
-- Stores uploaded documents (PDFs, images) for POs, GRNs, Invoices, RFQs, Quotes
-- Separate from odoo_documents which requires odoo_attachment_id NOT NULL

CREATE TABLE IF NOT EXISTS procurement_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,        -- 'purchase_order', 'goods_receipt_note', 'vendor_invoice', 'rfq_response', 'supplier_quote'
  entity_id UUID NOT NULL,
  document_type VARCHAR(50) NOT NULL DEFAULT 'other',  -- 'quote_pdf', 'invoice', 'delivery_note', 'grv', 'receipt', 'contract', 'image', 'other'
  document_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_path VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by VARCHAR(255) NOT NULL,
  uploaded_by_name VARCHAR(255),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups by entity
CREATE INDEX IF NOT EXISTS idx_proc_docs_entity ON procurement_documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_proc_docs_type ON procurement_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_proc_docs_active ON procurement_documents(is_active) WHERE is_active = true;
