-- Migration: 102_stock_categories.sql
-- Description: Dynamic hierarchical stock categories
-- Replaces hardcoded CHECK constraint in stock_items table
-- Date: January 2026

-- ============================================
-- STOCK CATEGORIES (Dynamic, Hierarchical)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,           -- e.g., 'CABLES', 'CABLES-DROP', 'ONT'
  name VARCHAR(255) NOT NULL,                  -- e.g., 'Drop Cables'
  description TEXT,

  -- Hierarchy
  parent_id UUID REFERENCES stock_categories(id) ON DELETE SET NULL,
  level INT DEFAULT 1,                         -- 1=root, 2=child, 3=grandchild
  path VARCHAR(500),                           -- Materialized path: '/CABLES/DROP/'

  -- Display
  icon VARCHAR(50),                            -- Lucide icon name
  color VARCHAR(20),                           -- Tailwind color class (e.g., 'blue', 'green')
  sort_order INT DEFAULT 0,

  -- Tracking defaults for items in this category
  default_tracking_type VARCHAR(20) DEFAULT 'quantity',  -- serial, lot, quantity
  default_uom VARCHAR(20) DEFAULT 'EA',                  -- EA, M, KM, etc.

  -- Flags
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,             -- System categories can't be deleted

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID
);

-- Indexes for hierarchy queries
CREATE INDEX IF NOT EXISTS idx_stock_categories_parent ON stock_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_stock_categories_path ON stock_categories(path);
CREATE INDEX IF NOT EXISTS idx_stock_categories_code ON stock_categories(code);
CREATE INDEX IF NOT EXISTS idx_stock_categories_active ON stock_categories(is_active) WHERE is_active = true;

-- ============================================
-- MIGRATE EXISTING CATEGORIES
-- Insert system categories for existing hardcoded values
-- ============================================
INSERT INTO stock_categories (code, name, icon, color, default_tracking_type, default_uom, is_system, sort_order, path) VALUES
  ('ONT', 'ONT Devices', 'Router', 'blue', 'serial', 'EA', true, 1, '/ONT/'),
  ('ROUTER', 'Routers', 'Wifi', 'indigo', 'serial', 'EA', true, 2, '/ROUTER/'),
  ('MINI_UPS', 'Mini UPS', 'Battery', 'yellow', 'serial', 'EA', true, 3, '/MINI_UPS/'),
  ('DROP_CABLE', 'Drop Cables', 'Cable', 'green', 'quantity', 'M', true, 4, '/DROP_CABLE/'),
  ('FIBER_CABLE', 'Fiber Cables', 'Cable', 'emerald', 'quantity', 'M', true, 5, '/FIBER_CABLE/'),
  ('CONNECTOR', 'Connectors', 'Plug', 'purple', 'quantity', 'EA', true, 6, '/CONNECTOR/'),
  ('CONSUMABLE', 'Consumables', 'Package', 'gray', 'quantity', 'EA', true, 7, '/CONSUMABLE/'),
  ('TOOL', 'Tools', 'Wrench', 'orange', 'serial', 'EA', true, 8, '/TOOL/'),
  ('PPE', 'Personal Protective Equipment', 'HardHat', 'red', 'quantity', 'EA', true, 9, '/PPE/')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- ADD CATEGORY_ID TO STOCK_ITEMS
-- ============================================
ALTER TABLE stock_items
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES stock_categories(id);

-- Create index for category lookups
CREATE INDEX IF NOT EXISTS idx_stock_items_category_id ON stock_items(category_id);

-- ============================================
-- MIGRATE EXISTING ITEMS TO USE CATEGORY_ID
-- Map old category VARCHAR to new category_id
-- ============================================
UPDATE stock_items si
SET category_id = sc.id
FROM stock_categories sc
WHERE UPPER(si.category) = sc.code
  AND si.category_id IS NULL;

-- ============================================
-- REMOVE OLD CHECK CONSTRAINT (if exists)
-- Note: The constraint name may vary
-- ============================================
DO $$
BEGIN
  -- Try to drop various possible constraint names
  ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS stock_items_category_check;
  ALTER TABLE stock_items DROP CONSTRAINT IF EXISTS chk_stock_items_category;
EXCEPTION WHEN OTHERS THEN
  -- Ignore errors if constraints don't exist
  NULL;
END $$;

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_categories_updated_at ON stock_categories;
CREATE TRIGGER trg_stock_categories_updated_at
  BEFORE UPDATE ON stock_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_categories_updated_at();

-- ============================================
-- PATH UPDATE TRIGGER (maintains materialized path)
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_category_path()
RETURNS TRIGGER AS $$
DECLARE
  parent_path VARCHAR(500);
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path = '/' || NEW.code || '/';
    NEW.level = 1;
  ELSE
    SELECT path, level INTO parent_path, NEW.level
    FROM stock_categories
    WHERE id = NEW.parent_id;

    NEW.path = parent_path || NEW.code || '/';
    NEW.level = NEW.level + 1;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_category_path ON stock_categories;
CREATE TRIGGER trg_stock_category_path
  BEFORE INSERT OR UPDATE OF parent_id, code ON stock_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_category_path();

-- ============================================
-- HELPER VIEW FOR CATEGORY TREE (simplified)
-- ============================================
CREATE OR REPLACE VIEW v_stock_categories_tree AS
SELECT
  sc.*,
  pc.name as parent_name,
  pc.code as parent_code,
  (SELECT COUNT(*) FROM stock_items WHERE category_id = sc.id) as item_count
FROM stock_categories sc
LEFT JOIN stock_categories pc ON sc.parent_id = pc.id
ORDER BY sc.level, sc.sort_order, sc.name;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_categories TO neondb_owner;
GRANT SELECT ON v_stock_categories_tree TO neondb_owner;
