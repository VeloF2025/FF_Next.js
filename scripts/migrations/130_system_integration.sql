-- =============================================================================
-- Migration 130: System Integration - Project Hub Foundation
-- Sprint 1: Project Hub Foundation
-- Created: 2026-01-25
-- =============================================================================
-- Purpose:
-- - Add is_primary flag to staff_projects for PM tracking
-- - Create v_project_team view (unified staff + contractors)
-- - Create v_project_dashboard view (aggregated metrics)
-- =============================================================================

-- ============================================================================
-- 1. Add is_primary column to staff_projects
-- ============================================================================
-- This replaces the project_manager field on projects table
-- Allows single source of truth for all project team assignments

ALTER TABLE staff_projects
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false;

-- Create index for efficient primary manager lookups
CREATE INDEX IF NOT EXISTS idx_staff_projects_primary
  ON staff_projects(project_id, is_primary)
  WHERE is_primary = true;

COMMENT ON COLUMN staff_projects.is_primary IS 'Indicates if this staff member is the primary project manager';

-- ============================================================================
-- 2. Create v_project_team view
-- ============================================================================
-- Unifies staff and contractors into single team view
-- Used by /api/projects/[id]/team endpoint

CREATE OR REPLACE VIEW v_project_team AS
SELECT
  sp.project_id,
  sp.staff_id::text as person_id,
  'staff' as person_type,
  COALESCE(s.first_name || ' ' || s.last_name, 'Unknown') as name,
  s.email,
  s.phone,
  sp.role,
  sp.start_date,
  sp.end_date,
  sp.is_active,
  sp.is_primary,
  sp.created_at
FROM staff_projects sp
JOIN staff s ON s.id = sp.staff_id
UNION ALL
SELECT
  cp.project_id,
  cp.contractor_id::text as person_id,
  'contractor' as person_type,
  c.company_name as name,
  c.email,
  c.phone,
  cp.role,
  cp.start_date,
  cp.end_date,
  cp.is_active,
  cp.is_primary_contractor as is_primary,
  cp.created_at
FROM contractor_projects cp
JOIN contractors c ON c.id = cp.contractor_id;

COMMENT ON VIEW v_project_team IS 'Unified view of project team members (staff and contractors)';

-- ============================================================================
-- 3. Create v_project_dashboard view
-- ============================================================================
-- Aggregates metrics from all modules for project dashboard
-- Used by /api/projects/[id]/dashboard endpoint

CREATE OR REPLACE VIEW v_project_dashboard AS
SELECT
  p.id,
  p.project_code,
  p.project_name,
  p.status,
  p.progress,
  p.budget,
  p.actual_cost,
  p.start_date,
  p.end_date,
  p.client_id,
  c.company_name as client_name,

  -- Budget metrics from project_budgets table
  pb.total_budget,
  pb.committed_amount,
  pb.actual_amount as budget_actual_amount,
  pb.available_budget,
  CASE
    WHEN pb.total_budget IS NULL OR pb.total_budget = 0 THEN 'unknown'
    WHEN pb.actual_amount IS NULL THEN 'healthy'
    WHEN (pb.actual_amount / pb.total_budget) * 100 >= 100 THEN 'critical'
    WHEN (pb.actual_amount / pb.total_budget) * 100 >= 80 THEN 'warning'
    ELSE 'healthy'
  END as budget_health,

  -- Team counts
  (SELECT COUNT(*) FROM staff_projects sp
   WHERE sp.project_id = p.id AND sp.is_active = true) as staff_count,
  (SELECT COUNT(*) FROM contractor_projects cp
   WHERE cp.project_id = p.id AND cp.is_active = true) as contractor_count,

  -- Primary manager
  (SELECT s.first_name || ' ' || s.last_name
   FROM staff_projects sp
   JOIN staff s ON s.id = sp.staff_id
   WHERE sp.project_id = p.id AND sp.is_primary = true
   LIMIT 1) as primary_manager_name,

  -- H&S metrics (latest audit)
  (SELECT overall_score FROM hs_project_audits
   WHERE project_id = p.id
   ORDER BY created_at DESC LIMIT 1) as latest_hs_score,
  (SELECT created_at FROM hs_project_audits
   WHERE project_id = p.id
   ORDER BY created_at DESC LIMIT 1) as last_audit_date,

  -- Maintenance metrics (project_id is TEXT in maintenance_tickets)
  (SELECT COUNT(*) FROM maintenance_tickets
   WHERE project_id::text = p.id::text
   AND status NOT IN ('closed', 'resolved')) as open_tickets,
  (SELECT COUNT(*) FROM maintenance_tickets
   WHERE project_id::text = p.id::text
   AND status = 'resolved'
   AND resolved_at >= NOW() - INTERVAL '30 days') as resolved_this_month,

  -- Procurement metrics
  (SELECT COUNT(*) FROM purchase_orders
   WHERE project_id = p.id
   AND status = 'pending_approval') as pending_pos,
  (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders
   WHERE project_id = p.id) as total_po_value,
  (SELECT COUNT(*) FROM rfqs
   WHERE project_id::text = p.id::text
   AND status = 'open') as pending_rfqs,

  p.created_at,
  p.updated_at
FROM projects p
LEFT JOIN clients c ON c.id = p.client_id
LEFT JOIN project_budgets pb ON pb.project_id = p.id;

COMMENT ON VIEW v_project_dashboard IS 'Aggregated project metrics from all modules for dashboard display';

-- ============================================================================
-- 4. Create function to calculate budget health
-- ============================================================================
-- Returns 'healthy', 'warning', or 'critical' based on utilization

CREATE OR REPLACE FUNCTION calculate_budget_health(
  total DECIMAL,
  actual DECIMAL
) RETURNS TEXT AS $$
BEGIN
  IF total IS NULL OR total = 0 THEN
    RETURN 'unknown';
  END IF;

  IF actual IS NULL THEN
    RETURN 'healthy';
  END IF;

  DECLARE utilization DECIMAL := (actual / total) * 100;
  BEGIN
    IF utilization >= 100 THEN
      RETURN 'critical';
    ELSIF utilization >= 80 THEN
      RETURN 'warning';
    ELSE
      RETURN 'healthy';
    END IF;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_budget_health IS 'Calculates budget health status based on utilization percentage';

-- ============================================================================
-- 5. Ensure unique primary manager per project (constraint)
-- ============================================================================
-- Only one staff member can be primary per project

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_projects_unique_primary
  ON staff_projects(project_id)
  WHERE is_primary = true;

-- ============================================================================
-- 6. Grant permissions
-- ============================================================================

-- Views are accessible to all authenticated users
GRANT SELECT ON v_project_team TO PUBLIC;
GRANT SELECT ON v_project_dashboard TO PUBLIC;
