-- Migration 112: Bundle Usage Tracking
-- Adds bundle_id to stock_movements and creates usage views for reporting

-- Add bundle_id to stock_movements to track which bundle was used
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS bundle_id UUID REFERENCES stock_bundles(id);

-- Create index for efficient bundle lookups
CREATE INDEX IF NOT EXISTS idx_stock_movements_bundle_id ON stock_movements(bundle_id);

-- Create a view for bundle usage reporting
-- Shows how bundles are used across projects
CREATE OR REPLACE VIEW v_bundle_usage AS
SELECT
  sm.project_id,
  p.project_name,
  sb.id as bundle_id,
  sb.bundle_code,
  sb.name as bundle_name,
  sb.bundle_type,
  COUNT(DISTINCT sm.id) as times_used,
  SUM(smi.quantity) as total_items_used,
  vbs.effective_price as bundle_price,
  vbs.effective_price * COUNT(DISTINCT sm.id) as total_value,
  MIN(sm.created_at) as first_used,
  MAX(sm.created_at) as last_used
FROM stock_movements sm
JOIN stock_bundles sb ON sm.bundle_id = sb.id
JOIN stock_bundle_items smi ON smi.bundle_id = sb.id
JOIN v_stock_bundles_summary vbs ON vbs.id = sb.id
LEFT JOIN projects p ON sm.project_id = p.id::text
WHERE sm.bundle_id IS NOT NULL
GROUP BY sm.project_id, p.project_name, sb.id, sb.bundle_code, sb.name, sb.bundle_type, vbs.effective_price;

-- Create a view for individual item consumption from bundles
CREATE OR REPLACE VIEW v_bundle_item_consumption AS
SELECT
  sm.project_id,
  p.project_name,
  sb.id as bundle_id,
  sb.bundle_code,
  sb.name as bundle_name,
  sbi.stock_item_id,
  si.item_code,
  si.name as item_name,
  si.category,
  sbi.quantity as qty_per_bundle,
  COUNT(DISTINCT sm.id) as times_bundle_used,
  sbi.quantity * COUNT(DISTINCT sm.id) as total_consumed,
  COALESCE(sbi.price_override, si.standard_cost, 0) as unit_cost,
  (sbi.quantity * COUNT(DISTINCT sm.id)) * COALESCE(sbi.price_override, si.standard_cost, 0) as total_cost,
  MIN(sm.created_at) as first_used,
  MAX(sm.created_at) as last_used
FROM stock_movements sm
JOIN stock_bundles sb ON sm.bundle_id = sb.id
JOIN stock_bundle_items sbi ON sbi.bundle_id = sb.id
JOIN stock_items si ON si.id = sbi.stock_item_id
LEFT JOIN projects p ON sm.project_id = p.id::text
WHERE sm.bundle_id IS NOT NULL
GROUP BY
  sm.project_id,
  p.project_name,
  sb.id,
  sb.bundle_code,
  sb.name,
  sbi.stock_item_id,
  si.item_code,
  si.name,
  si.category,
  sbi.quantity,
  sbi.price_override,
  si.standard_cost;

-- Create a summary view for bundle cost analysis
CREATE OR REPLACE VIEW v_bundle_cost_analysis AS
SELECT
  sb.id as bundle_id,
  sb.bundle_code,
  sb.name as bundle_name,
  sb.bundle_type,
  vbs.item_count,
  vbs.base_cost,
  vbs.discount_amount,
  vbs.effective_price,
  COUNT(DISTINCT sm.id) as total_uses,
  COUNT(DISTINCT sm.project_id) as projects_used,
  vbs.effective_price * COUNT(DISTINCT sm.id) as total_revenue,
  vbs.base_cost * COUNT(DISTINCT sm.id) as total_base_cost,
  (vbs.effective_price - vbs.base_cost) * COUNT(DISTINCT sm.id) as total_margin
FROM stock_bundles sb
JOIN v_stock_bundles_summary vbs ON vbs.id = sb.id
LEFT JOIN stock_movements sm ON sm.bundle_id = sb.id
WHERE sb.is_active = true
GROUP BY
  sb.id,
  sb.bundle_code,
  sb.name,
  sb.bundle_type,
  vbs.item_count,
  vbs.base_cost,
  vbs.discount_amount,
  vbs.effective_price;

-- Create a view for bundle inventory value by project/location
CREATE OR REPLACE VIEW v_bundle_inventory_value AS
SELECT
  COALESCE(sm.project_id, 'unassigned') as project_id,
  p.project_name,
  sb.bundle_type,
  COUNT(DISTINCT sb.id) as unique_bundles,
  COUNT(sm.id) as bundle_instances,
  SUM(vbs.effective_price) as total_value
FROM stock_bundles sb
JOIN v_stock_bundles_summary vbs ON vbs.id = sb.id
LEFT JOIN stock_movements sm ON sm.bundle_id = sb.id AND sm.status != 'cancelled'
LEFT JOIN projects p ON sm.project_id = p.id::text
WHERE sb.is_active = true
GROUP BY COALESCE(sm.project_id, 'unassigned'), p.project_name, sb.bundle_type;

COMMENT ON VIEW v_bundle_usage IS 'Bundle usage statistics per project - shows how many times each bundle was used';
COMMENT ON VIEW v_bundle_item_consumption IS 'Individual item consumption from bundles - tracks item-level usage';
COMMENT ON VIEW v_bundle_cost_analysis IS 'Bundle cost analysis - revenue, margin, and usage counts';
COMMENT ON VIEW v_bundle_inventory_value IS 'Bundle inventory value by project and type';
