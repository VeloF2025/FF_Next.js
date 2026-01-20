-- Migration: 103_stock_bundles.sql
-- Description: Stock bundles/kits for grouping items together
-- Example: "Pole Installation Kit" = ONT + UPS + 15m Drop Cable + Connectors
-- Date: January 2026

-- ============================================
-- STOCK BUNDLES (Kit/Bundle Definitions)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_code VARCHAR(50) UNIQUE NOT NULL,       -- e.g., 'KIT-POLE-STD', 'KIT-HOME-PREM'
  name VARCHAR(255) NOT NULL,                     -- e.g., 'Standard Pole Installation Kit'
  description TEXT,

  -- Classification
  category_id UUID REFERENCES stock_categories(id),
  bundle_type VARCHAR(50) DEFAULT 'kit',          -- kit, combo, assembly

  -- Pricing
  price_type VARCHAR(20) DEFAULT 'calculated',    -- calculated (sum of items), fixed, markup
  fixed_price NUMERIC(12,2),                      -- Used when price_type = 'fixed'
  markup_percentage NUMERIC(5,2),                 -- Used when price_type = 'markup'
  currency VARCHAR(3) DEFAULT 'ZAR',

  -- Usage tracking
  usage_count INT DEFAULT 0,                      -- How many times this bundle has been used

  -- Flags
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,               -- Default kit for category
  allow_substitution BOOLEAN DEFAULT false,       -- Can items be swapped out

  -- Metadata
  notes TEXT,
  tags VARCHAR(255)[],                            -- Array of tags for filtering

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_bundles_code ON stock_bundles(bundle_code);
CREATE INDEX IF NOT EXISTS idx_stock_bundles_category ON stock_bundles(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_bundles_active ON stock_bundles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_stock_bundles_type ON stock_bundles(bundle_type);

-- ============================================
-- STOCK BUNDLE ITEMS (Bundle Components)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_bundle_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id UUID NOT NULL REFERENCES stock_bundles(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,

  -- Quantity
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  uom VARCHAR(20),                                -- Override UOM if different from item

  -- Pricing override
  price_override NUMERIC(12,2),                   -- NULL = use item's standard_cost
  discount_percentage NUMERIC(5,2),               -- Apply discount to item in bundle

  -- Configuration
  is_optional BOOLEAN DEFAULT false,              -- Can be excluded from bundle
  is_configurable BOOLEAN DEFAULT false,          -- Quantity can be changed
  min_quantity NUMERIC(10,2) DEFAULT 0,           -- Min if configurable
  max_quantity NUMERIC(10,2),                     -- Max if configurable

  -- Substitution (if bundle allows_substitution)
  substitute_group VARCHAR(50),                   -- Items in same group can substitute each other

  -- Display
  sort_order INT DEFAULT 0,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one item per bundle
  UNIQUE(bundle_id, stock_item_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_bundle_items_bundle ON stock_bundle_items(bundle_id);
CREATE INDEX IF NOT EXISTS idx_stock_bundle_items_item ON stock_bundle_items(stock_item_id);

-- ============================================
-- VIEW: Bundle with calculated totals
-- ============================================
CREATE OR REPLACE VIEW v_stock_bundles_summary AS
SELECT
  b.*,
  sc.name as category_name,
  sc.code as category_code,
  COUNT(bi.id) as item_count,
  SUM(bi.quantity) as total_quantity,
  SUM(
    bi.quantity * COALESCE(bi.price_override, si.standard_cost, 0)
    * (1 - COALESCE(bi.discount_percentage, 0) / 100)
  ) as calculated_price,
  CASE
    WHEN b.price_type = 'fixed' THEN b.fixed_price
    WHEN b.price_type = 'markup' THEN
      SUM(bi.quantity * COALESCE(bi.price_override, si.standard_cost, 0))
      * (1 + COALESCE(b.markup_percentage, 0) / 100)
    ELSE
      SUM(bi.quantity * COALESCE(bi.price_override, si.standard_cost, 0)
        * (1 - COALESCE(bi.discount_percentage, 0) / 100))
  END as effective_price
FROM stock_bundles b
LEFT JOIN stock_categories sc ON b.category_id = sc.id
LEFT JOIN stock_bundle_items bi ON bi.bundle_id = b.id
LEFT JOIN stock_items si ON bi.stock_item_id = si.id
GROUP BY b.id, sc.id;

-- ============================================
-- VIEW: Bundle items with item details
-- ============================================
CREATE OR REPLACE VIEW v_stock_bundle_items_detail AS
SELECT
  bi.*,
  b.bundle_code,
  b.name as bundle_name,
  si.item_code,
  si.name as item_name,
  si.description as item_description,
  si.category as item_category,
  si.tracking_type,
  COALESCE(bi.uom, si.uom) as effective_uom,
  si.standard_cost as item_cost,
  COALESCE(bi.price_override, si.standard_cost, 0) as effective_cost,
  bi.quantity * COALESCE(bi.price_override, si.standard_cost, 0)
    * (1 - COALESCE(bi.discount_percentage, 0) / 100) as line_total,
  sc.name as item_category_name,
  sc.icon as item_category_icon,
  sc.color as item_category_color
FROM stock_bundle_items bi
JOIN stock_bundles b ON bi.bundle_id = b.id
JOIN stock_items si ON bi.stock_item_id = si.id
LEFT JOIN stock_categories sc ON si.category_id = sc.id
ORDER BY bi.sort_order, si.name;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_bundles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_bundles_updated_at ON stock_bundles;
CREATE TRIGGER trg_stock_bundles_updated_at
  BEFORE UPDATE ON stock_bundles
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_bundles_updated_at();

DROP TRIGGER IF EXISTS trg_stock_bundle_items_updated_at ON stock_bundle_items;
CREATE TRIGGER trg_stock_bundle_items_updated_at
  BEFORE UPDATE ON stock_bundle_items
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_bundles_updated_at();

-- ============================================
-- SAMPLE DATA: Common installation kits
-- ============================================
-- Note: This requires existing stock items. Run after stock items are populated.
-- Uncomment and modify item IDs as needed.

/*
-- Create a standard pole installation kit
INSERT INTO stock_bundles (bundle_code, name, description, bundle_type, is_active, is_default)
VALUES (
  'KIT-POLE-STD',
  'Standard Pole Installation Kit',
  'Complete kit for standard pole installation including ONT, UPS, drop cable and connectors',
  'kit',
  true,
  true
);

-- Add items to the kit (replace with actual stock_item IDs)
-- INSERT INTO stock_bundle_items (bundle_id, stock_item_id, quantity, sort_order)
-- SELECT b.id, si.id, 1, 1
-- FROM stock_bundles b, stock_items si
-- WHERE b.bundle_code = 'KIT-POLE-STD' AND si.item_code = 'ONT-001';
*/

-- ============================================
-- GRANT PERMISSIONS
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_bundles TO neondb_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_bundle_items TO neondb_owner;
GRANT SELECT ON v_stock_bundles_summary TO neondb_owner;
GRANT SELECT ON v_stock_bundle_items_detail TO neondb_owner;
