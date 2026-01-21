-- Migration: 105_cost_centers.sql
-- Description: Add cost center hierarchy for granular cost allocation
-- Hierarchy: Project → Phase → Zone → Pole/Drop
-- Created: 2025-01-21

-- =====================================================
-- COST CENTER TYPES
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_center_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  hierarchy_level INTEGER NOT NULL DEFAULT 1,  -- 1=Project, 2=Phase, 3=Zone, 4=Asset
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default cost center types
INSERT INTO cost_center_types (code, name, description, hierarchy_level, sort_order) VALUES
  ('project', 'Project', 'Top-level project cost center', 1, 1),
  ('phase', 'Phase', 'Project phase (civil, optical, drops)', 2, 2),
  ('zone', 'Zone', 'Geographic zone within project', 3, 3),
  ('pon', 'PON', 'Passive Optical Network area', 3, 4),
  ('pole', 'Pole', 'Individual pole/structure', 4, 5),
  ('drop', 'Drop', 'Individual customer drop', 4, 6),
  ('department', 'Department', 'Internal department', 2, 7),
  ('team', 'Team', 'Work team or crew', 3, 8)
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- COST CENTERS (Hierarchical)
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Hierarchy
  parent_id UUID REFERENCES cost_centers(id) ON DELETE CASCADE,
  cost_center_type_id UUID REFERENCES cost_center_types(id),
  hierarchy_path TEXT,  -- Materialized path: /root/child/grandchild
  depth INTEGER DEFAULT 1,

  -- Project linkage
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

  -- Budget allocation
  allocated_budget DECIMAL(15,2) DEFAULT 0,
  committed_amount DECIMAL(15,2) DEFAULT 0,
  actual_amount DECIMAL(15,2) DEFAULT 0,
  available_amount DECIMAL(15,2) DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_locked BOOLEAN DEFAULT false,  -- Prevent further allocations

  -- Reference to external entities
  reference_type VARCHAR(50),  -- 'zone', 'pole', 'drop', 'phase', etc.
  reference_id UUID,  -- FK to the referenced entity

  -- Metadata
  sort_order INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',

  -- Audit
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique code per project
  CONSTRAINT uq_cost_center_project_code UNIQUE (project_id, code)
);

-- =====================================================
-- COST CENTER ALLOCATIONS
-- Records budget allocation from parent to child
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_center_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cost_center_id UUID NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  budget_category_id UUID REFERENCES budget_categories(id),
  budget_item_id UUID REFERENCES budget_items(id),

  -- Allocation type
  allocation_type VARCHAR(50) NOT NULL DEFAULT 'budget',  -- 'budget', 'commitment', 'actual'

  -- Amount
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'ZAR',

  -- Reference
  reference_type VARCHAR(50),  -- 'po', 'grn', 'invoice', 'manual'
  reference_id UUID,
  reference_number VARCHAR(100),

  -- Description
  description TEXT,

  -- Period (for budgeting by period)
  fiscal_year INTEGER,
  fiscal_period INTEGER,

  -- Audit
  created_by VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COST CENTER TRANSACTIONS
-- Individual cost transactions linked to cost centers
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_center_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  cost_center_id UUID NOT NULL REFERENCES cost_centers(id) ON DELETE CASCADE,
  allocation_id UUID REFERENCES cost_center_allocations(id),

  -- Transaction details
  transaction_type VARCHAR(50) NOT NULL,  -- 'expense', 'revenue', 'transfer_in', 'transfer_out'
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Amount
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'ZAR',

  -- Reference
  reference_type VARCHAR(50),  -- 'po', 'grn', 'invoice', 'journal', 'manual'
  reference_id UUID,
  reference_number VARCHAR(100),

  -- Description
  description TEXT,

  -- Stock item reference (if applicable)
  stock_item_id UUID REFERENCES stock_items(id),
  quantity DECIMAL(12,4),
  unit_cost DECIMAL(15,4),

  -- Status
  status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'approved', 'posted', 'reversed'

  -- Audit
  created_by VARCHAR(100),
  approved_by VARCHAR(100),
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_project ON cost_centers(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_type ON cost_centers(cost_center_type_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_hierarchy ON cost_centers(hierarchy_path);
CREATE INDEX IF NOT EXISTS idx_cost_centers_reference ON cost_centers(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_cost_centers_active ON cost_centers(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_cc_allocations_center ON cost_center_allocations(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_cc_allocations_category ON cost_center_allocations(budget_category_id);
CREATE INDEX IF NOT EXISTS idx_cc_allocations_reference ON cost_center_allocations(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_cc_transactions_center ON cost_center_transactions(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_date ON cost_center_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_status ON cost_center_transactions(status);
CREATE INDEX IF NOT EXISTS idx_cc_transactions_reference ON cost_center_transactions(reference_type, reference_id);

-- =====================================================
-- TRIGGER: Update hierarchy path and depth
-- =====================================================
CREATE OR REPLACE FUNCTION update_cost_center_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.hierarchy_path := '/' || NEW.id::text;
    NEW.depth := 1;
  ELSE
    SELECT hierarchy_path || '/' || NEW.id::text, depth + 1
    INTO NEW.hierarchy_path, NEW.depth
    FROM cost_centers
    WHERE id = NEW.parent_id;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cost_center_hierarchy ON cost_centers;
CREATE TRIGGER trg_cost_center_hierarchy
  BEFORE INSERT OR UPDATE OF parent_id ON cost_centers
  FOR EACH ROW
  EXECUTE FUNCTION update_cost_center_hierarchy();

-- =====================================================
-- TRIGGER: Update cost center totals
-- =====================================================
CREATE OR REPLACE FUNCTION update_cost_center_totals()
RETURNS TRIGGER AS $$
DECLARE
  v_cost_center_id UUID;
BEGIN
  -- Determine which cost center to update
  IF TG_OP = 'DELETE' THEN
    v_cost_center_id := OLD.cost_center_id;
  ELSE
    v_cost_center_id := NEW.cost_center_id;
  END IF;

  -- Update the cost center totals
  UPDATE cost_centers cc SET
    committed_amount = COALESCE((
      SELECT SUM(amount) FROM cost_center_allocations
      WHERE cost_center_id = cc.id AND allocation_type = 'commitment'
    ), 0),
    actual_amount = COALESCE((
      SELECT SUM(amount) FROM cost_center_transactions
      WHERE cost_center_id = cc.id AND status = 'posted' AND transaction_type = 'expense'
    ), 0),
    available_amount = cc.allocated_budget - COALESCE((
      SELECT SUM(amount) FROM cost_center_allocations
      WHERE cost_center_id = cc.id AND allocation_type = 'commitment'
    ), 0),
    updated_at = NOW()
  WHERE id = v_cost_center_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_allocation_totals ON cost_center_allocations;
CREATE TRIGGER trg_cc_allocation_totals
  AFTER INSERT OR UPDATE OR DELETE ON cost_center_allocations
  FOR EACH ROW
  EXECUTE FUNCTION update_cost_center_totals();

DROP TRIGGER IF EXISTS trg_cc_transaction_totals ON cost_center_transactions;
CREATE TRIGGER trg_cc_transaction_totals
  AFTER INSERT OR UPDATE OR DELETE ON cost_center_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_cost_center_totals();

-- =====================================================
-- VIEW: Cost Center Summary with Hierarchy
-- =====================================================
CREATE OR REPLACE VIEW v_cost_centers_summary AS
SELECT
  cc.id,
  cc.code,
  cc.name,
  cc.description,
  cc.parent_id,
  parent.code AS parent_code,
  parent.name AS parent_name,
  cct.code AS type_code,
  cct.name AS type_name,
  cct.hierarchy_level,
  cc.hierarchy_path,
  cc.depth,
  cc.project_id,
  p.project_code,
  p.project_name,
  cc.allocated_budget,
  cc.committed_amount,
  cc.actual_amount,
  cc.available_amount,
  CASE
    WHEN cc.allocated_budget > 0 THEN
      ROUND((cc.actual_amount / cc.allocated_budget * 100)::numeric, 2)
    ELSE 0
  END AS utilization_percent,
  CASE
    WHEN cc.allocated_budget > 0 THEN
      ROUND((cc.committed_amount / cc.allocated_budget * 100)::numeric, 2)
    ELSE 0
  END AS commitment_percent,
  cc.is_active,
  cc.is_locked,
  cc.reference_type,
  cc.reference_id,
  cc.created_at,
  cc.updated_at,
  -- Child count
  (SELECT COUNT(*) FROM cost_centers WHERE parent_id = cc.id) AS child_count,
  -- Transaction count
  (SELECT COUNT(*) FROM cost_center_transactions WHERE cost_center_id = cc.id) AS transaction_count
FROM cost_centers cc
LEFT JOIN cost_centers parent ON cc.parent_id = parent.id
LEFT JOIN cost_center_types cct ON cc.cost_center_type_id = cct.id
LEFT JOIN projects p ON cc.project_id = p.id;

-- =====================================================
-- VIEW: Cost Center Tree (Recursive)
-- =====================================================
CREATE OR REPLACE VIEW v_cost_center_tree AS
WITH RECURSIVE cost_tree AS (
  -- Base: root cost centers
  SELECT
    id,
    code,
    name,
    parent_id,
    project_id,
    allocated_budget,
    committed_amount,
    actual_amount,
    available_amount,
    1 AS level,
    ARRAY[sort_order] AS sort_path,
    code AS full_path
  FROM cost_centers
  WHERE parent_id IS NULL AND is_active = true

  UNION ALL

  -- Recursive: children
  SELECT
    cc.id,
    cc.code,
    cc.name,
    cc.parent_id,
    cc.project_id,
    cc.allocated_budget,
    cc.committed_amount,
    cc.actual_amount,
    cc.available_amount,
    ct.level + 1,
    ct.sort_path || cc.sort_order,
    ct.full_path || ' > ' || cc.code
  FROM cost_centers cc
  JOIN cost_tree ct ON cc.parent_id = ct.id
  WHERE cc.is_active = true
)
SELECT * FROM cost_tree
ORDER BY sort_path;

-- =====================================================
-- FUNCTION: Get cost center descendants
-- =====================================================
CREATE OR REPLACE FUNCTION get_cost_center_descendants(p_cost_center_id UUID)
RETURNS TABLE (
  id UUID,
  code VARCHAR(50),
  name VARCHAR(255),
  depth INTEGER,
  allocated_budget DECIMAL(15,2),
  committed_amount DECIMAL(15,2),
  actual_amount DECIMAL(15,2)
) AS $$
WITH RECURSIVE descendants AS (
  SELECT
    cc.id,
    cc.code,
    cc.name,
    cc.depth,
    cc.allocated_budget,
    cc.committed_amount,
    cc.actual_amount
  FROM cost_centers cc
  WHERE cc.id = p_cost_center_id

  UNION ALL

  SELECT
    cc.id,
    cc.code,
    cc.name,
    cc.depth,
    cc.allocated_budget,
    cc.committed_amount,
    cc.actual_amount
  FROM cost_centers cc
  JOIN descendants d ON cc.parent_id = d.id
)
SELECT * FROM descendants;
$$ LANGUAGE sql;

-- =====================================================
-- FUNCTION: Roll up cost center totals
-- =====================================================
CREATE OR REPLACE FUNCTION rollup_cost_center_totals(p_cost_center_id UUID)
RETURNS TABLE (
  total_allocated DECIMAL(15,2),
  total_committed DECIMAL(15,2),
  total_actual DECIMAL(15,2),
  total_available DECIMAL(15,2)
) AS $$
  SELECT
    SUM(allocated_budget) AS total_allocated,
    SUM(committed_amount) AS total_committed,
    SUM(actual_amount) AS total_actual,
    SUM(allocated_budget) - SUM(committed_amount) AS total_available
  FROM get_cost_center_descendants(p_cost_center_id);
$$ LANGUAGE sql;

-- =====================================================
-- Add cost_center_id to related tables
-- =====================================================
-- Add to purchase_orders if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_orders') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'purchase_orders' AND column_name = 'cost_center_id') THEN
      ALTER TABLE purchase_orders ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
    END IF;
  END IF;
END $$;

-- Add to stock_movements if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stock_movements') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'stock_movements' AND column_name = 'cost_center_id') THEN
      ALTER TABLE stock_movements ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
    END IF;
  END IF;
END $$;

-- Add to budget_transactions if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'budget_transactions') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_transactions' AND column_name = 'cost_center_id') THEN
      ALTER TABLE budget_transactions ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
    END IF;
  END IF;
END $$;

-- =====================================================
-- COMPLETION
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 105_cost_centers.sql completed successfully';
  RAISE NOTICE 'Tables created: cost_center_types, cost_centers, cost_center_allocations, cost_center_transactions';
  RAISE NOTICE 'Views created: v_cost_centers_summary, v_cost_center_tree';
  RAISE NOTICE 'Functions created: get_cost_center_descendants, rollup_cost_center_totals';
END $$;
