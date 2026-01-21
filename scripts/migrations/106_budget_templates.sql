-- Migration: 106_budget_templates.sql
-- Description: Add budget templates and cost center integration
-- Created: 2025-01-21

-- =====================================================
-- BUDGET TEMPLATES
-- Reusable budget templates with predefined categories
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template info
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Template type
  template_type VARCHAR(50) DEFAULT 'project',  -- 'project', 'phase', 'department'

  -- Default values
  default_currency VARCHAR(3) DEFAULT 'ZAR',
  default_enforce_budget BOOLEAN DEFAULT true,
  default_allow_override BOOLEAN DEFAULT false,
  default_warning_threshold DECIMAL(5,2) DEFAULT 80.00,
  default_critical_threshold DECIMAL(5,2) DEFAULT 95.00,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_system BOOLEAN DEFAULT false,  -- System templates can't be deleted

  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Audit
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- BUDGET TEMPLATE CATEGORIES
-- Predefined categories for each template
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_template_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  template_id UUID NOT NULL REFERENCES budget_templates(id) ON DELETE CASCADE,

  -- Category info
  category_code VARCHAR(50) NOT NULL,
  category_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Default allocation
  default_percent DECIMAL(5,2),  -- e.g., 30% of total budget
  default_amount DECIMAL(15,2),  -- Fixed amount if percent not used

  -- Display
  sort_order INTEGER DEFAULT 0,
  color VARCHAR(20),  -- For charts
  icon VARCHAR(50),

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(template_id, category_code)
);

-- =====================================================
-- Link Cost Centers to Budget Items
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budget_items' AND column_name = 'cost_center_id'
  ) THEN
    ALTER TABLE budget_items ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
  END IF;
END $$;

-- Link Cost Centers to Budget Categories
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budget_categories' AND column_name = 'cost_center_id'
  ) THEN
    ALTER TABLE budget_categories ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
  END IF;
END $$;

-- Link Cost Centers to Budget Transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'budget_transactions' AND column_name = 'cost_center_id'
  ) THEN
    ALTER TABLE budget_transactions ADD COLUMN cost_center_id UUID REFERENCES cost_centers(id);
  END IF;
END $$;

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_budget_templates_active ON budget_templates(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_budget_templates_type ON budget_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_budget_template_cats_template ON budget_template_categories(template_id);
CREATE INDEX IF NOT EXISTS idx_budget_items_cost_center ON budget_items(cost_center_id);
CREATE INDEX IF NOT EXISTS idx_budget_categories_cost_center ON budget_categories(cost_center_id);

-- =====================================================
-- INSERT DEFAULT TEMPLATES
-- =====================================================

-- Fiber Installation Project Template
INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
  ('FIBER_INSTALL', 'Fiber Installation Project', 'Standard budget template for fiber installation projects', 'project', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
SELECT t.id, cat.code, cat.name, cat.pct, cat.sort, cat.color
FROM budget_templates t
CROSS JOIN (VALUES
  ('MATERIALS', 'Materials & Cable', 35.00, 1, '#3b82f6'),
  ('EQUIPMENT', 'Equipment & Tools', 10.00, 2, '#8b5cf6'),
  ('CIVIL', 'Civil Works', 20.00, 3, '#f59e0b'),
  ('LABOR', 'Labor & Installation', 20.00, 4, '#22c55e'),
  ('TRANSPORT', 'Transport & Logistics', 5.00, 5, '#06b6d4'),
  ('OVERHEAD', 'Overhead & Admin', 5.00, 6, '#6b7280'),
  ('CONTINGENCY', 'Contingency Reserve', 5.00, 7, '#ef4444')
) AS cat(code, name, pct, sort, color)
WHERE t.code = 'FIBER_INSTALL'
ON CONFLICT (template_id, category_code) DO NOTHING;

-- Maintenance Project Template
INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
  ('MAINTENANCE', 'Maintenance Project', 'Budget template for network maintenance projects', 'project', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
SELECT t.id, cat.code, cat.name, cat.pct, cat.sort, cat.color
FROM budget_templates t
CROSS JOIN (VALUES
  ('LABOR', 'Labor & Technicians', 40.00, 1, '#22c55e'),
  ('MATERIALS', 'Replacement Parts', 25.00, 2, '#3b82f6'),
  ('EQUIPMENT', 'Test Equipment', 10.00, 3, '#8b5cf6'),
  ('TRANSPORT', 'Transport & Travel', 15.00, 4, '#06b6d4'),
  ('CONTINGENCY', 'Emergency Reserve', 10.00, 5, '#ef4444')
) AS cat(code, name, pct, sort, color)
WHERE t.code = 'MAINTENANCE'
ON CONFLICT (template_id, category_code) DO NOTHING;

-- Civil Works Template
INSERT INTO budget_templates (code, name, description, template_type, is_system) VALUES
  ('CIVIL_WORKS', 'Civil Works', 'Budget template for civil construction work', 'project', true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO budget_template_categories (template_id, category_code, category_name, default_percent, sort_order, color)
SELECT t.id, cat.code, cat.name, cat.pct, cat.sort, cat.color
FROM budget_templates t
CROSS JOIN (VALUES
  ('LABOR', 'Labor & Crews', 35.00, 1, '#22c55e'),
  ('MATERIALS', 'Construction Materials', 30.00, 2, '#3b82f6'),
  ('EQUIPMENT', 'Heavy Equipment Rental', 15.00, 3, '#8b5cf6'),
  ('SUBCONTRACT', 'Subcontractors', 10.00, 4, '#f59e0b'),
  ('PERMITS', 'Permits & Fees', 5.00, 5, '#06b6d4'),
  ('CONTINGENCY', 'Contingency', 5.00, 6, '#ef4444')
) AS cat(code, name, pct, sort, color)
WHERE t.code = 'CIVIL_WORKS'
ON CONFLICT (template_id, category_code) DO NOTHING;

-- =====================================================
-- VIEW: Budget Template Summary
-- =====================================================
CREATE OR REPLACE VIEW v_budget_templates_summary AS
SELECT
  bt.id,
  bt.code,
  bt.name,
  bt.description,
  bt.template_type,
  bt.default_currency,
  bt.default_enforce_budget,
  bt.default_warning_threshold,
  bt.default_critical_threshold,
  bt.is_active,
  bt.is_system,
  bt.usage_count,
  bt.last_used_at,
  bt.created_at,
  COUNT(btc.id) AS category_count,
  COALESCE(SUM(btc.default_percent), 0) AS total_percent
FROM budget_templates bt
LEFT JOIN budget_template_categories btc ON bt.id = btc.template_id
GROUP BY bt.id;

-- =====================================================
-- VIEW: Project Budgets Summary (for dashboard)
-- =====================================================
CREATE OR REPLACE VIEW v_project_budgets_dashboard AS
SELECT
  pb.id,
  pb.project_id,
  p.project_code,
  p.project_name,
  pb.source_type,
  pb.total_budget,
  pb.committed_amount,
  pb.actual_amount,
  pb.available_budget,
  pb.variance_amount,
  pb.variance_percent,
  pb.status,
  pb.enforce_budget,
  pb.currency,
  CASE
    WHEN pb.total_budget > 0 THEN
      ROUND((pb.committed_amount / pb.total_budget * 100)::numeric, 2)
    ELSE 0
  END AS utilization_percent,
  CASE
    WHEN pb.total_budget > 0 THEN
      CASE
        WHEN pb.committed_amount / pb.total_budget >= pb.alert_threshold_critical / 100 THEN 'critical'
        WHEN pb.committed_amount / pb.total_budget >= pb.alert_threshold_warning / 100 THEN 'warning'
        ELSE 'healthy'
      END
    ELSE 'healthy'
  END AS health_status,
  pb.alert_threshold_warning,
  pb.alert_threshold_critical,
  (SELECT COUNT(*) FROM budget_alerts WHERE project_budget_id = pb.id AND status = 'active') AS active_alerts,
  (SELECT COUNT(*) FROM budget_categories WHERE project_budget_id = pb.id) AS category_count,
  pb.created_at,
  pb.updated_at
FROM project_budgets pb
LEFT JOIN projects p ON pb.project_id = p.id;

-- =====================================================
-- FUNCTION: Create Budget from Template
-- =====================================================
CREATE OR REPLACE FUNCTION create_budget_from_template(
  p_project_id UUID,
  p_template_id UUID,
  p_total_budget DECIMAL(15,2),
  p_created_by VARCHAR(100) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_budget_id UUID;
  v_template RECORD;
BEGIN
  -- Get template
  SELECT * INTO v_template FROM budget_templates WHERE id = p_template_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found';
  END IF;

  -- Create budget
  INSERT INTO project_budgets (
    project_id,
    source_type,
    total_budget,
    available_budget,
    currency,
    enforce_budget,
    allow_override,
    alert_threshold_warning,
    alert_threshold_critical,
    status,
    created_by
  ) VALUES (
    p_project_id,
    'manual',
    p_total_budget,
    p_total_budget,
    v_template.default_currency,
    v_template.default_enforce_budget,
    v_template.default_allow_override,
    v_template.default_warning_threshold,
    v_template.default_critical_threshold,
    'draft',
    p_created_by
  )
  RETURNING id INTO v_budget_id;

  -- Create categories from template
  INSERT INTO budget_categories (
    project_budget_id,
    category_code,
    category_name,
    allocated_amount,
    available_amount,
    sort_order
  )
  SELECT
    v_budget_id,
    btc.category_code,
    btc.category_name,
    CASE
      WHEN btc.default_percent IS NOT NULL THEN
        ROUND((p_total_budget * btc.default_percent / 100)::numeric, 2)
      ELSE
        COALESCE(btc.default_amount, 0)
    END,
    CASE
      WHEN btc.default_percent IS NOT NULL THEN
        ROUND((p_total_budget * btc.default_percent / 100)::numeric, 2)
      ELSE
        COALESCE(btc.default_amount, 0)
    END,
    btc.sort_order
  FROM budget_template_categories btc
  WHERE btc.template_id = p_template_id
  ORDER BY btc.sort_order;

  -- Update template usage
  UPDATE budget_templates SET
    usage_count = usage_count + 1,
    last_used_at = NOW()
  WHERE id = p_template_id;

  RETURN v_budget_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMPLETION
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE 'Migration 106_budget_templates.sql completed successfully';
  RAISE NOTICE 'Tables created: budget_templates, budget_template_categories';
  RAISE NOTICE 'Views created: v_budget_templates_summary, v_project_budgets_dashboard';
  RAISE NOTICE 'Function created: create_budget_from_template';
END $$;
