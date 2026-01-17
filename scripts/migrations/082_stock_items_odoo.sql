-- Migration 082: Expand stock_items for Odoo sync and add supplier mapping
-- Run: npx tsx scripts/run-migration.ts 082

-- ============================================================================
-- 1. EXPAND STOCK_ITEMS TABLE
-- ============================================================================

-- Add Odoo link
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS odoo_product_id INTEGER UNIQUE;

-- Add inventory tracking fields
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS qty_available NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS qty_reserved NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS qty_on_order NUMERIC DEFAULT 0;

-- Add pricing fields
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS list_price NUMERIC,
ADD COLUMN IF NOT EXISTS last_purchase_price NUMERIC;

-- Add product type (consu = consumable, service = service)
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS product_type VARCHAR(50) DEFAULT 'consu';

-- Add purchase/sale flags
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS purchase_ok BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS sale_ok BOOLEAN DEFAULT FALSE;

-- Add Odoo sync tracking
ALTER TABLE stock_items
ADD COLUMN IF NOT EXISTS odoo_synced_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);

-- Create index for Odoo lookups
CREATE INDEX IF NOT EXISTS idx_stock_items_odoo_product_id
ON stock_items(odoo_product_id) WHERE odoo_product_id IS NOT NULL;

-- Create index for category lookups
CREATE INDEX IF NOT EXISTS idx_stock_items_category
ON stock_items(category);

-- ============================================================================
-- 2. CREATE SUPPLIER ITEM CODES MAPPING TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_item_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to stock item
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,

  -- Link to supplier
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  -- Supplier's item code for this product
  supplier_item_code VARCHAR(100) NOT NULL,
  supplier_item_name VARCHAR(255),

  -- Pricing from supplier
  supplier_price NUMERIC,
  supplier_currency VARCHAR(10) DEFAULT 'ZAR',
  price_valid_from DATE,
  price_valid_to DATE,

  -- Lead time in days
  lead_time_days INTEGER,

  -- Minimum order quantity
  min_order_qty NUMERIC DEFAULT 1,

  -- Status
  is_preferred BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by VARCHAR(100),

  -- Unique constraint: one supplier code per supplier per stock item
  UNIQUE(supplier_id, supplier_item_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supplier_item_codes_stock_item
ON supplier_item_codes(stock_item_id);

CREATE INDEX IF NOT EXISTS idx_supplier_item_codes_supplier
ON supplier_item_codes(supplier_id);

CREATE INDEX IF NOT EXISTS idx_supplier_item_codes_code
ON supplier_item_codes(supplier_item_code);

-- ============================================================================
-- 3. CREATE STOCK LEVELS TABLE (for warehouse-specific quantities)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stock_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,

  -- Odoo location info
  odoo_location_id INTEGER,
  location_name VARCHAR(255),

  -- Quantities
  qty_on_hand NUMERIC DEFAULT 0,
  qty_reserved NUMERIC DEFAULT 0,
  qty_available NUMERIC GENERATED ALWAYS AS (qty_on_hand - qty_reserved) STORED,

  -- Last count/update
  last_count_date TIMESTAMP WITH TIME ZONE,
  last_count_by VARCHAR(100),

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One record per item per warehouse
  UNIQUE(stock_item_id, warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_levels_item
ON stock_levels(stock_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_levels_warehouse
ON stock_levels(warehouse_id);

-- ============================================================================
-- 4. ADD COMMENTS
-- ============================================================================

COMMENT ON COLUMN stock_items.odoo_product_id IS 'Link to Odoo product.product ID';
COMMENT ON COLUMN stock_items.qty_available IS 'Total available quantity across all warehouses';
COMMENT ON COLUMN stock_items.product_type IS 'consu=consumable, service=service';

COMMENT ON TABLE supplier_item_codes IS 'Maps supplier-specific item codes to internal stock items';
COMMENT ON TABLE stock_levels IS 'Warehouse-specific stock quantities';
