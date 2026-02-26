-- Migration 220: Add cost centre allocation to purchase requisitions
-- Ensures every PR is allocated to either a project OR a cost centre.

-- 1. Add cost_center_id to purchase_requisitions
ALTER TABLE purchase_requisitions
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 2. Ensure purchase_orders also has cost_center_id (migration 105 may not have applied)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS cost_center_id UUID REFERENCES cost_centers(id);

-- 3. Add index for cost centre lookups
CREATE INDEX IF NOT EXISTS idx_pr_cost_center ON purchase_requisitions(cost_center_id)
  WHERE cost_center_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_po_cost_center ON purchase_orders(cost_center_id)
  WHERE cost_center_id IS NOT NULL;
