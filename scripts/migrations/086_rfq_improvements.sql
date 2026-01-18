-- Migration: 086_rfq_improvements.sql
-- Purpose: Improve RFQ module with junction table for suppliers and stock item linking
-- Date: 2026-01-18

-- ============================================================================
-- 1. RFQ-SUPPLIERS JUNCTION TABLE
-- Replace JSON array with proper junction table for better querying
-- ============================================================================

CREATE TABLE IF NOT EXISTS rfq_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  viewed_at TIMESTAMP WITH TIME ZONE,
  responded_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) DEFAULT 'invited', -- invited, viewed, responded, declined, awarded
  invitation_sent BOOLEAN DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(rfq_id, supplier_id)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_rfq_id ON rfq_suppliers(rfq_id);
CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_supplier_id ON rfq_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_rfq_suppliers_status ON rfq_suppliers(status);

COMMENT ON TABLE rfq_suppliers IS 'Junction table linking RFQs to invited suppliers with tracking';
COMMENT ON COLUMN rfq_suppliers.status IS 'Status: invited, viewed, responded, declined, awarded';

-- ============================================================================
-- 2. STOCK ITEM LINKING FOR RFQ ITEMS
-- Allow RFQ items to link to stock catalog for consistency
-- ============================================================================

ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id);
ALTER TABLE rfq_items ADD COLUMN IF NOT EXISTS boq_item_id UUID REFERENCES boq_items(id);

CREATE INDEX IF NOT EXISTS idx_rfq_items_stock_item_id ON rfq_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_rfq_items_boq_item_id ON rfq_items(boq_item_id);

COMMENT ON COLUMN rfq_items.stock_item_id IS 'Link to stock catalog item (optional but encouraged)';
COMMENT ON COLUMN rfq_items.boq_item_id IS 'Link to source BOQ item if imported from BOQ';

-- ============================================================================
-- 3. STOCK ITEM LINKING FOR BOQ ITEMS
-- Allow BOQ items to link to stock catalog
-- ============================================================================

ALTER TABLE boq_items ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id);

CREATE INDEX IF NOT EXISTS idx_boq_items_stock_item_id ON boq_items(stock_item_id);

COMMENT ON COLUMN boq_items.stock_item_id IS 'Link to stock catalog item (optional but encouraged)';

-- ============================================================================
-- 4. MIGRATE EXISTING DATA
-- Move invited_suppliers JSON array to junction table
-- ============================================================================

-- Migration function to move JSON array to junction table
DO $$
DECLARE
  rfq_record RECORD;
  supplier_id_text TEXT;
BEGIN
  -- Loop through all RFQs with invited_suppliers JSON array
  FOR rfq_record IN
    SELECT id, invited_suppliers
    FROM rfqs
    WHERE invited_suppliers IS NOT NULL
      AND invited_suppliers != '[]'::json
      AND invited_suppliers::text != '[]'
  LOOP
    -- Parse JSON array and insert into junction table
    FOR supplier_id_text IN
      SELECT json_array_elements_text(rfq_record.invited_suppliers::json)
    LOOP
      -- Skip if not a valid integer
      IF supplier_id_text ~ '^\d+$' THEN
        INSERT INTO rfq_suppliers (rfq_id, supplier_id, status)
        VALUES (rfq_record.id, supplier_id_text::integer, 'invited')
        ON CONFLICT (rfq_id, supplier_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Migration complete: moved invited_suppliers to rfq_suppliers table';
END $$;

-- ============================================================================
-- 5. UPDATE RFQ_RESPONSES TO LINK TO RFQ_SUPPLIERS
-- ============================================================================

ALTER TABLE rfq_responses ADD COLUMN IF NOT EXISTS rfq_supplier_id UUID REFERENCES rfq_suppliers(id);

-- Update existing responses to link to rfq_suppliers
UPDATE rfq_responses rr
SET rfq_supplier_id = rs.id
FROM rfq_suppliers rs
WHERE rr.rfq_id = rs.rfq_id
  AND rr.supplier_id::text = rs.supplier_id::text
  AND rr.rfq_supplier_id IS NULL;

-- ============================================================================
-- 6. HELPER VIEW FOR RFQ WITH SUPPLIERS
-- ============================================================================

CREATE OR REPLACE VIEW rfq_with_suppliers AS
SELECT
  r.id,
  r.rfq_number,
  r.project_id,
  r.title,
  r.status,
  r.response_deadline,
  r.created_at,
  COALESCE(
    json_agg(
      json_build_object(
        'id', rs.id,
        'supplierId', rs.supplier_id,
        'supplierName', s.name,
        'status', rs.status,
        'invitedAt', rs.invited_at,
        'respondedAt', rs.responded_at
      )
    ) FILTER (WHERE rs.id IS NOT NULL),
    '[]'::json
  ) as suppliers,
  COUNT(rs.id) as supplier_count
FROM rfqs r
LEFT JOIN rfq_suppliers rs ON r.id = rs.rfq_id
LEFT JOIN suppliers s ON rs.supplier_id = s.id
GROUP BY r.id;

COMMENT ON VIEW rfq_with_suppliers IS 'RFQs with their invited suppliers as JSON array';

-- ============================================================================
-- 7. MIGRATION TRACKING
-- ============================================================================

INSERT INTO migrations (name, executed_at)
VALUES ('086_rfq_improvements', NOW())
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================================================
-- DROP VIEW IF EXISTS rfq_with_suppliers;
-- ALTER TABLE rfq_responses DROP COLUMN IF EXISTS rfq_supplier_id;
-- ALTER TABLE boq_items DROP COLUMN IF EXISTS stock_item_id;
-- ALTER TABLE rfq_items DROP COLUMN IF EXISTS boq_item_id;
-- ALTER TABLE rfq_items DROP COLUMN IF EXISTS stock_item_id;
-- DROP TABLE IF EXISTS rfq_suppliers;
-- DELETE FROM migrations WHERE name = '086_rfq_improvements';
