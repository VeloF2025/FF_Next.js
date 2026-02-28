-- Migration 222: Cross-module document links
-- Enables documents in procurement_documents to appear on linked accounting entities
-- and vice versa (one file visible from both modules)

CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES procurement_documents(id) ON DELETE CASCADE,
  linked_entity_type VARCHAR(50) NOT NULL,
  linked_entity_id UUID NOT NULL,
  link_reason VARCHAR(100),  -- 'po_invoice_link', 'grn_invoice_link', 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_links_document ON document_links(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_links_entity ON document_links(linked_entity_type, linked_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_links_unique ON document_links(document_id, linked_entity_type, linked_entity_id);
