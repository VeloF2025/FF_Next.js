-- Migration: 104_stock_takes.sql
-- Description: Stock Take / Physical Inventory Count feature
-- Enables periodic stock counting with variance tracking and approval workflow
-- Date: January 2026

-- ============================================
-- STOCK TAKES (Count Sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_takes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number VARCHAR(50) UNIQUE NOT NULL,    -- e.g., 'ST-2026-001'
  name VARCHAR(255) NOT NULL,                       -- e.g., 'Q1 2026 Full Count'
  description TEXT,

  -- Scope
  location_id UUID REFERENCES stock_locations(id),  -- NULL = all locations
  warehouse_id UUID,                                -- NULL = all warehouses (no FK - warehouses is a view)
  category_id UUID REFERENCES stock_categories(id), -- NULL = all categories
  project_id UUID REFERENCES projects(id),          -- Project scope

  -- Type
  stock_take_type VARCHAR(50) DEFAULT 'full',       -- full, partial, cycle, spot
  count_method VARCHAR(50) DEFAULT 'blind',         -- blind (no expected shown), guided

  -- Schedule
  scheduled_date DATE,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,

  -- Status
  status VARCHAR(50) DEFAULT 'draft',               -- draft, in_progress, pending_review, approved, cancelled

  -- Approval
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,

  -- Summary (calculated after completion)
  total_items INT DEFAULT 0,
  counted_items INT DEFAULT 0,
  variance_items INT DEFAULT 0,
  total_variance_value NUMERIC(12,2) DEFAULT 0,

  -- Metadata
  notes TEXT,
  tags VARCHAR(255)[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  updated_by UUID
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_takes_reference ON stock_takes(reference_number);
CREATE INDEX IF NOT EXISTS idx_stock_takes_status ON stock_takes(status);
CREATE INDEX IF NOT EXISTS idx_stock_takes_location ON stock_takes(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_takes_warehouse ON stock_takes(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_takes_scheduled ON stock_takes(scheduled_date);

-- ============================================
-- STOCK TAKE LINES (Individual Item Counts)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_take_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id UUID NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE RESTRICT,

  -- Location
  location_id UUID REFERENCES stock_locations(id),
  warehouse_id UUID,                                -- No FK - warehouses is a view
  bin_location VARCHAR(100),                        -- Shelf/bin reference

  -- Expected (system quantity at start)
  expected_quantity NUMERIC(12,3) DEFAULT 0,
  expected_value NUMERIC(12,2) DEFAULT 0,

  -- Counted
  counted_quantity NUMERIC(12,3),
  counted_at TIMESTAMPTZ,
  counted_by UUID,
  counted_by_name VARCHAR(255),

  -- Recount (if needed)
  recount_quantity NUMERIC(12,3),
  recounted_at TIMESTAMPTZ,
  recounted_by UUID,
  recounted_by_name VARCHAR(255),

  -- Variance (calculated by trigger)
  variance_quantity NUMERIC(12,3) DEFAULT 0,
  variance_value NUMERIC(12,2) DEFAULT 0,           -- Calculated from item cost
  variance_percentage NUMERIC(8,2),                 -- % variance

  -- Status
  status VARCHAR(50) DEFAULT 'pending',             -- pending, counted, recounted, verified, adjusted

  -- Adjustment
  adjustment_reason VARCHAR(255),
  adjustment_notes TEXT,
  adjusted_at TIMESTAMPTZ,
  adjusted_by UUID,

  -- Serial/Lot tracking (for serialized items)
  serial_numbers TEXT[],                            -- Array of serial numbers counted
  lot_numbers TEXT[],                               -- Array of lot numbers

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index: one line per item per location per stock take
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_take_lines_unique
  ON stock_take_lines(stock_take_id, stock_item_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_take ON stock_take_lines(stock_take_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_item ON stock_take_lines(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_location ON stock_take_lines(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_status ON stock_take_lines(status);
CREATE INDEX IF NOT EXISTS idx_stock_take_lines_variance ON stock_take_lines(variance_quantity) WHERE variance_quantity != 0;

-- ============================================
-- STOCK TAKE ADJUSTMENTS (Audit Trail)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_take_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_take_id UUID NOT NULL REFERENCES stock_takes(id) ON DELETE CASCADE,
  stock_take_line_id UUID NOT NULL REFERENCES stock_take_lines(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),

  -- Adjustment details
  adjustment_type VARCHAR(50) NOT NULL,             -- increase, decrease, write_off
  quantity_before NUMERIC(12,3) NOT NULL,
  quantity_after NUMERIC(12,3) NOT NULL,
  adjustment_quantity NUMERIC(12,3) NOT NULL,

  -- Value
  unit_cost NUMERIC(12,2),
  adjustment_value NUMERIC(12,2),

  -- Reason
  reason_code VARCHAR(50),                          -- damaged, theft, expired, found, error
  reason_description TEXT,

  -- Approval
  approved_by UUID,
  approved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID,
  created_by_name VARCHAR(255)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_stock_take_adjustments_take ON stock_take_adjustments(stock_take_id);
CREATE INDEX IF NOT EXISTS idx_stock_take_adjustments_item ON stock_take_adjustments(stock_item_id);

-- ============================================
-- VIEW: Stock Take Summary
-- ============================================
CREATE OR REPLACE VIEW v_stock_takes_summary AS
SELECT
  st.id,
  st.reference_number,
  st.name,
  st.description,
  st.location_id,
  st.warehouse_id,
  st.category_id,
  st.project_id,
  st.stock_take_type,
  st.count_method,
  st.scheduled_date,
  st.start_date,
  st.end_date,
  st.status,
  st.approved_by,
  st.approved_at,
  st.approval_notes,
  st.total_items,
  st.counted_items,
  st.variance_items,
  st.notes,
  st.tags,
  st.created_at,
  st.updated_at,
  st.created_by,
  st.updated_by,
  sl.name as location_name,
  sl.code as location_code,
  w.name as warehouse_name,
  w.code as warehouse_code,
  sc.name as category_name,
  p.project_name,
  COUNT(stl.id) as line_count,
  COUNT(stl.id) FILTER (WHERE stl.status IN ('counted', 'recounted', 'verified')) as counted_count,
  COUNT(stl.id) FILTER (WHERE stl.variance_quantity != 0) as variance_count,
  SUM(ABS(COALESCE(stl.variance_quantity, 0))) as total_variance_qty,
  SUM(ABS(COALESCE(stl.variance_value, 0))) as calc_variance_value,
  CASE
    WHEN COUNT(stl.id) > 0
    THEN ROUND(COUNT(stl.id) FILTER (WHERE stl.counted_quantity IS NOT NULL)::numeric / COUNT(stl.id) * 100, 1)
    ELSE 0
  END as completion_percentage
FROM stock_takes st
LEFT JOIN stock_locations sl ON st.location_id = sl.id
LEFT JOIN warehouses w ON st.warehouse_id = w.id
LEFT JOIN stock_categories sc ON st.category_id = sc.id
LEFT JOIN projects p ON st.project_id = p.id
LEFT JOIN stock_take_lines stl ON stl.stock_take_id = st.id
GROUP BY st.id, sl.id, sl.name, sl.code, w.id, w.name, w.code, sc.id, sc.name, p.id, p.project_name;

-- ============================================
-- VIEW: Stock Take Lines with Item Details
-- ============================================
CREATE OR REPLACE VIEW v_stock_take_lines_detail AS
SELECT
  stl.*,
  si.item_code,
  si.name as item_name,
  si.category as item_category,
  si.tracking_type,
  si.uom,
  si.standard_cost,
  sc.name as category_name,
  sc.icon as category_icon,
  sc.color as category_color,
  sl.name as location_name,
  sl.code as location_code,
  w.name as warehouse_name,
  st.reference_number as stock_take_reference,
  st.name as stock_take_name,
  st.status as stock_take_status
FROM stock_take_lines stl
JOIN stock_takes st ON stl.stock_take_id = st.id
JOIN stock_items si ON stl.stock_item_id = si.id
LEFT JOIN stock_categories sc ON si.category_id = sc.id
LEFT JOIN stock_locations sl ON stl.location_id = sl.id
LEFT JOIN warehouses w ON stl.warehouse_id = w.id;

-- ============================================
-- FUNCTION: Generate Stock Take Reference
-- ============================================
CREATE OR REPLACE FUNCTION generate_stock_take_reference()
RETURNS VARCHAR(50) AS $$
DECLARE
  year_part VARCHAR(4);
  seq_num INT;
  new_ref VARCHAR(50);
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(reference_number FROM 'ST-' || year_part || '-(\d+)') AS INT)
  ), 0) + 1
  INTO seq_num
  FROM stock_takes
  WHERE reference_number LIKE 'ST-' || year_part || '-%';

  new_ref := 'ST-' || year_part || '-' || LPAD(seq_num::TEXT, 4, '0');

  RETURN new_ref;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Initialize Stock Take Lines
-- Creates lines for all items matching the scope
-- ============================================
CREATE OR REPLACE FUNCTION initialize_stock_take_lines(take_id UUID)
RETURNS INT AS $$
DECLARE
  take_record RECORD;
  items_added INT := 0;
BEGIN
  -- Get stock take details
  SELECT * INTO take_record FROM stock_takes WHERE id = take_id;

  IF take_record IS NULL THEN
    RAISE EXCEPTION 'Stock take not found';
  END IF;

  -- Insert lines for matching items (skip if already exists)
  INSERT INTO stock_take_lines (stock_take_id, stock_item_id, location_id, warehouse_id, expected_quantity, expected_value)
  SELECT
    take_id,
    si.id,
    take_record.location_id,
    take_record.warehouse_id,
    COALESCE(si.qty_available, 0),
    COALESCE(si.qty_available, 0) * COALESCE(si.standard_cost, 0)
  FROM stock_items si
  WHERE si.is_active = true
    AND (take_record.category_id IS NULL OR si.category_id = take_record.category_id)
    AND NOT EXISTS (
      SELECT 1 FROM stock_take_lines stl
      WHERE stl.stock_take_id = take_id
        AND stl.stock_item_id = si.id
        AND COALESCE(stl.location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(take_record.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

  GET DIAGNOSTICS items_added = ROW_COUNT;

  -- Update stock take totals
  UPDATE stock_takes
  SET total_items = items_added,
      updated_at = NOW()
  WHERE id = take_id;

  RETURN items_added;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Update Variance Calculations
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_take_line_variance()
RETURNS TRIGGER AS $$
DECLARE
  item_cost NUMERIC(12,2);
BEGIN
  -- Calculate variance quantity
  NEW.variance_quantity := COALESCE(NEW.recount_quantity, NEW.counted_quantity, 0) - NEW.expected_quantity;

  -- Get item cost
  SELECT COALESCE(si.standard_cost, 0) INTO item_cost
  FROM stock_items si WHERE si.id = NEW.stock_item_id;

  -- Calculate variance value
  NEW.variance_value := NEW.variance_quantity * item_cost;

  -- Calculate percentage
  IF NEW.expected_quantity > 0 THEN
    NEW.variance_percentage := ROUND((NEW.variance_quantity / NEW.expected_quantity) * 100, 2);
  ELSE
    NEW.variance_percentage := NULL;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_take_line_variance ON stock_take_lines;
CREATE TRIGGER trg_stock_take_line_variance
  BEFORE INSERT OR UPDATE OF counted_quantity, recount_quantity ON stock_take_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_take_line_variance();

-- ============================================
-- TRIGGER: Update Stock Take Summaries
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_take_summary()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE stock_takes st
  SET
    counted_items = (SELECT COUNT(*) FROM stock_take_lines WHERE stock_take_id = st.id AND counted_quantity IS NOT NULL),
    variance_items = (SELECT COUNT(*) FROM stock_take_lines WHERE stock_take_id = st.id AND variance_quantity != 0),
    total_variance_value = (SELECT COALESCE(SUM(ABS(variance_value)), 0) FROM stock_take_lines WHERE stock_take_id = st.id),
    updated_at = NOW()
  WHERE st.id = COALESCE(NEW.stock_take_id, OLD.stock_take_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_take_summary ON stock_take_lines;
CREATE TRIGGER trg_stock_take_summary
  AFTER INSERT OR UPDATE OR DELETE ON stock_take_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_take_summary();

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_stock_takes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_takes_updated_at ON stock_takes;
CREATE TRIGGER trg_stock_takes_updated_at
  BEFORE UPDATE ON stock_takes
  FOR EACH ROW
  EXECUTE FUNCTION update_stock_takes_updated_at();

-- ============================================
-- REASON CODES (Reference Data)
-- ============================================
CREATE TABLE IF NOT EXISTS stock_adjustment_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  adjustment_type VARCHAR(50),                      -- increase, decrease, both
  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0
);

INSERT INTO stock_adjustment_reasons (code, name, adjustment_type, sort_order) VALUES
  ('DAMAGED', 'Damaged/Broken', 'decrease', 1),
  ('THEFT', 'Theft/Shrinkage', 'decrease', 2),
  ('EXPIRED', 'Expired/Obsolete', 'decrease', 3),
  ('FOUND', 'Found/Located', 'increase', 4),
  ('COUNT_ERROR', 'Counting Error', 'both', 5),
  ('SYSTEM_ERROR', 'System Discrepancy', 'both', 6),
  ('TRANSFER', 'Unrecorded Transfer', 'both', 7),
  ('USAGE', 'Unrecorded Usage', 'decrease', 8),
  ('RECEIPT', 'Unrecorded Receipt', 'increase', 9),
  ('OTHER', 'Other', 'both', 10)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_takes TO neondb_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_take_lines TO neondb_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_take_adjustments TO neondb_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustment_reasons TO neondb_owner;
GRANT SELECT ON v_stock_takes_summary TO neondb_owner;
GRANT SELECT ON v_stock_take_lines_detail TO neondb_owner;
