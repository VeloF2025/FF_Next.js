-- Migration: 142_quote_extractions.sql
-- Purpose: Store OCR/VLM extracted quote data for RFQ matching
-- Created: 2026-01-28

-- Table for storing quote document extractions
CREATE TABLE IF NOT EXISTS quote_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID REFERENCES rfqs(id) ON DELETE SET NULL,
  project_id UUID NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,

  -- Source document
  document_url TEXT NOT NULL,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('pdf', 'image')),
  document_name TEXT,
  document_size INTEGER,

  -- Extracted supplier info
  extracted_supplier_name TEXT,
  extracted_supplier_email TEXT,
  extracted_supplier_phone TEXT,
  extracted_supplier_vat TEXT,

  -- Extracted quote info
  extracted_quote_number TEXT,
  extracted_quote_date DATE,
  extracted_valid_until DATE,
  extracted_payment_terms TEXT,
  extracted_delivery_terms TEXT,
  extracted_delivery_days INTEGER,

  -- Extracted totals
  extracted_subtotal NUMERIC(15, 2),
  extracted_vat_rate NUMERIC(5, 2),
  extracted_vat_amount NUMERIC(15, 2),
  extracted_total NUMERIC(15, 2),
  extracted_currency VARCHAR(10) DEFAULT 'ZAR',

  -- Full extraction result (for complex data and line items)
  extraction_data JSONB NOT NULL DEFAULT '{}',

  -- Extraction metadata
  extraction_method VARCHAR(20) DEFAULT 'vlm' CHECK (extraction_method IN ('vlm', 'ocr', 'manual')),
  confidence_score NUMERIC(3, 2),
  processing_time_ms INTEGER,
  extraction_notes TEXT,

  -- Matching results (which RFQ items matched to which extracted items)
  matching_data JSONB,
  matched_items_count INTEGER DEFAULT 0,
  unmatched_items_count INTEGER DEFAULT 0,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'extracted' CHECK (status IN ('processing', 'extracted', 'matched', 'applied', 'failed', 'cancelled')),
  error_message TEXT,

  -- Link to created quote (if applied)
  applied_to_quote_id UUID,

  -- Audit
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_quote_extractions_rfq ON quote_extractions(rfq_id);
CREATE INDEX IF NOT EXISTS idx_quote_extractions_project ON quote_extractions(project_id);
CREATE INDEX IF NOT EXISTS idx_quote_extractions_supplier ON quote_extractions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_quote_extractions_status ON quote_extractions(status);
CREATE INDEX IF NOT EXISTS idx_quote_extractions_created ON quote_extractions(created_at DESC);

-- GIN index for JSONB queries
CREATE INDEX IF NOT EXISTS idx_quote_extractions_data ON quote_extractions USING GIN (extraction_data);
CREATE INDEX IF NOT EXISTS idx_quote_extractions_matching ON quote_extractions USING GIN (matching_data);

-- Table for individual extracted line items (denormalized for easier querying)
CREATE TABLE IF NOT EXISTS quote_extraction_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id UUID NOT NULL REFERENCES quote_extractions(id) ON DELETE CASCADE,

  -- Extracted line item data
  line_number INTEGER NOT NULL,
  item_code TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(15, 4),
  unit TEXT,
  unit_price NUMERIC(15, 4),
  total_price NUMERIC(15, 2),
  notes TEXT,

  -- Extraction confidence
  confidence_score NUMERIC(3, 2),

  -- Matching result
  matched_rfq_item_id UUID,
  match_confidence NUMERIC(3, 2),
  match_reason VARCHAR(30) CHECK (match_reason IN ('exact_code', 'fuzzy_description', 'quantity_unit', 'manual', 'unmatched')),

  -- Status
  is_matched BOOLEAN DEFAULT FALSE,
  is_skipped BOOLEAN DEFAULT FALSE,
  skip_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for extraction items
CREATE INDEX IF NOT EXISTS idx_extraction_items_extraction ON quote_extraction_items(extraction_id);
CREATE INDEX IF NOT EXISTS idx_extraction_items_matched ON quote_extraction_items(matched_rfq_item_id) WHERE matched_rfq_item_id IS NOT NULL;

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_quote_extractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_quote_extractions_updated_at ON quote_extractions;
CREATE TRIGGER trigger_quote_extractions_updated_at
  BEFORE UPDATE ON quote_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_quote_extractions_updated_at();

-- Add foreign key to quotes table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quotes') THEN
    ALTER TABLE quote_extractions
    ADD CONSTRAINT fk_quote_extractions_applied_quote
    FOREIGN KEY (applied_to_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- Constraint already exists
END $$;

COMMENT ON TABLE quote_extractions IS 'Stores OCR/VLM extracted data from supplier quote documents for RFQ matching';
COMMENT ON TABLE quote_extraction_items IS 'Individual line items extracted from quote documents';
COMMENT ON COLUMN quote_extractions.extraction_data IS 'Full JSON extraction result including raw VLM response';
COMMENT ON COLUMN quote_extractions.matching_data IS 'JSON containing item-to-RFQ matching results';
