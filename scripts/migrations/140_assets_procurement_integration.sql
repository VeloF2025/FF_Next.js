-- Migration 140: Assets Procurement Integration
-- Adds procurement linkage, VLM extraction metadata, and verification tracking to assets

-- 1. Add procurement linkage to assets table
ALTER TABLE assets ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES purchase_orders(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS grn_id UUID REFERENCES goods_receipt_notes(id);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS grn_item_id UUID;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS stock_item_id UUID REFERENCES stock_items(id);

-- 2. VLM extraction metadata
ALTER TABLE assets ADD COLUMN IF NOT EXISTS label_image_url TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS vlm_extracted_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS vlm_extraction_data JSONB;

-- 3. Verification tracking
ALTER TABLE assets ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255);
ALTER TABLE assets ADD COLUMN IF NOT EXISTS verification_image_url TEXT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE assets ADD COLUMN IF NOT EXISTS verification_mismatches JSONB;

-- 4. Category mapping for registration eligibility
CREATE TABLE IF NOT EXISTS asset_category_stock_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_category VARCHAR(100) NOT NULL,
  asset_category_id UUID REFERENCES asset_categories(id),
  requires_registration BOOLEAN DEFAULT false,
  vlm_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(stock_category)
);

-- 5. Batch registration tracking
CREATE TABLE IF NOT EXISTS asset_registration_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id UUID REFERENCES goods_receipt_notes(id),
  status VARCHAR(20) DEFAULT 'pending',
  total_items INT DEFAULT 0,
  registered_count INT DEFAULT 0,
  skipped_count INT DEFAULT 0,
  created_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 6. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_assets_grn ON assets(grn_id) WHERE grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_po ON assets(po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assets_verification_status ON assets(verification_status) WHERE verification_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_registration_batches_grn ON asset_registration_batches(grn_id);

-- 7. Add comment for documentation
COMMENT ON COLUMN assets.verification_status IS 'pending, verified, or mismatch';
COMMENT ON COLUMN assets.vlm_extraction_data IS 'JSON containing extracted label data: {manufacturer, model, serialNumber, confidence}';
