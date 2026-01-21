-- Migration: 108_pipeline_management.sql
-- Description: Pipeline Management Module - Track potential projects through approval gates
-- Created: 2026-01-21

-- ============================================================================
-- 1. APPROVAL TYPES CONFIGURATION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_approval_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- 'wayleave', 'municipal', 'environmental', 'traditional', 'other'

  -- Default settings
  default_required BOOLEAN DEFAULT false,
  typical_duration_days INTEGER,

  -- Issuing authority defaults
  default_authority_name VARCHAR(255),
  default_authority_contact TEXT,

  -- Document requirements
  required_documents JSONB DEFAULT '[]'::jsonb,

  -- Display
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default approval types
INSERT INTO pipeline_approval_types (code, name, category, default_required, typical_duration_days, display_order) VALUES
  ('wayleave_eskom', 'Wayleave - Eskom', 'wayleave', true, 90, 1),
  ('wayleave_telkom', 'Wayleave - Telkom', 'wayleave', false, 60, 2),
  ('wayleave_sanral', 'Wayleave - SANRAL', 'wayleave', false, 120, 3),
  ('wayleave_transnet', 'Wayleave - Transnet', 'wayleave', false, 90, 4),
  ('wayleave_prasa', 'Wayleave - PRASA', 'wayleave', false, 90, 5),
  ('wayleave_water', 'Wayleave - Water Affairs', 'wayleave', false, 60, 6),
  ('municipal_approval', 'Municipal Approval', 'municipal', true, 60, 10),
  ('municipal_roads', 'Municipal Roads Department', 'municipal', false, 45, 11),
  ('traditional_council', 'Traditional Council Permission', 'traditional', false, 45, 20),
  ('environmental_eia', 'Environmental Impact Assessment', 'environmental', false, 180, 30),
  ('environmental_heritage', 'Heritage Impact Assessment', 'environmental', false, 90, 31),
  ('environmental_wetland', 'Wetland Assessment', 'environmental', false, 60, 32)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 2. MAIN PIPELINE PROJECTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  project_code VARCHAR(50) UNIQUE,
  project_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Location
  province VARCHAR(100),
  municipality VARCHAR(100),
  area VARCHAR(255),
  address TEXT,
  coordinates JSONB, -- {lat, lng, polygon}

  -- Classification
  project_type VARCHAR(50) DEFAULT 'greenfield', -- 'greenfield', 'brownfield', 'extension', 'upgrade'
  priority VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'

  -- Client/Owner
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  client_contact_name VARCHAR(255),
  client_contact_email VARCHAR(255),
  client_contact_phone VARCHAR(50),

  -- Internal Assignment
  project_manager_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  wayleaves_officer_id UUID REFERENCES staff(id) ON DELETE SET NULL,
  operations_manager_id UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Smartsheet Sync
  smartsheet_id VARCHAR(100),
  smartsheet_sheet_id VARCHAR(100),
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'synced', 'conflict', 'error'
  sync_overrides JSONB DEFAULT '[]'::jsonb, -- Fields manually overridden

  -- Pipeline Status
  pipeline_status VARCHAR(30) DEFAULT 'new',
  -- 'new', 'qualification', 'approvals_in_progress', 'approvals_complete',
  -- 'po_pending', 'ready_to_plan', 'planned', 'on_hold', 'cancelled', 'lost'

  -- Financial Estimates
  estimated_value DECIMAL(15,2),
  estimated_homes_passed INTEGER,
  estimated_km DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'ZAR',

  -- Target Dates
  target_start_date DATE,
  target_completion_date DATE,

  -- PO Information
  po_number VARCHAR(100),
  po_date DATE,
  po_value DECIMAL(15,2),
  po_document_url VARCHAR(500),
  po_received_at TIMESTAMP WITH TIME ZONE,
  po_received_by UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Transition to Planned
  planned_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  transitioned_at TIMESTAMP WITH TIME ZONE,
  transitioned_by UUID REFERENCES staff(id) ON DELETE SET NULL,

  -- Additional Info
  notes TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  custom_fields JSONB DEFAULT '{}'::jsonb,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP WITH TIME ZONE,
  deleted_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

-- Indexes for pipeline_projects
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_status ON pipeline_projects(pipeline_status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_client ON pipeline_projects(client_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_smartsheet ON pipeline_projects(smartsheet_id) WHERE smartsheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_pm ON pipeline_projects(project_manager_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_province ON pipeline_projects(province) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_pipeline_projects_code ON pipeline_projects(project_code) WHERE project_code IS NOT NULL;

-- ============================================================================
-- 3. PROJECT APPROVALS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_project_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,
  approval_type_id UUID NOT NULL REFERENCES pipeline_approval_types(id) ON DELETE RESTRICT,

  -- Status tracking
  status VARCHAR(30) DEFAULT 'not_started',
  -- 'not_started', 'preparing', 'internal_review', 'submitted', 'in_review',
  -- 'additional_info_required', 'approved', 'conditionally_approved',
  -- 'rejected', 'expired', 'renewed', 'withdrawn'
  is_required BOOLEAN DEFAULT true,

  -- Application tracking
  application_date DATE,
  application_reference VARCHAR(100),
  application_document_url VARCHAR(500),

  -- Authority details
  authority_name VARCHAR(255),
  authority_contact_name VARCHAR(255),
  authority_contact_email VARCHAR(255),
  authority_contact_phone VARCHAR(50),
  authority_address TEXT,
  assigned_officer VARCHAR(255), -- Their officer handling it

  -- Follow-up tracking
  last_followup_date DATE,
  next_followup_date DATE,
  followup_count INTEGER DEFAULT 0,
  followup_notes TEXT,

  -- Approval details
  approval_date DATE,
  approval_reference VARCHAR(100),
  approval_document_url VARCHAR(500),
  issue_date DATE,
  expiry_date DATE,

  -- Financial
  application_fee DECIMAL(10,2),
  fee_paid BOOLEAN DEFAULT false,
  fee_paid_date DATE,
  fee_receipt_reference VARCHAR(100),
  fee_receipt_url VARCHAR(500),

  -- Coverage/Scope
  coverage_description TEXT,
  affected_coordinates JSONB, -- Route segments, coordinates
  conditions TEXT, -- Any conditions attached to approval

  -- Rejection handling
  rejection_date DATE,
  rejection_reason TEXT,
  appeal_submitted BOOLEAN DEFAULT false,
  appeal_date DATE,
  appeal_reference VARCHAR(100),

  -- Internal approval (2-level: PM -> Ops)
  internal_status VARCHAR(20) DEFAULT 'pending',
  -- 'pending', 'pm_approved', 'ops_approved', 'rejected'
  pm_approved_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  pm_approved_at TIMESTAMP WITH TIME ZONE,
  pm_notes TEXT,
  ops_approved_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  ops_approved_at TIMESTAMP WITH TIME ZONE,
  ops_notes TEXT,
  internal_rejected_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  internal_rejected_at TIMESTAMP WITH TIME ZONE,
  internal_rejection_reason TEXT,

  -- Smartsheet sync
  smartsheet_columns JSONB, -- Mapped SS columns for this approval
  last_synced_at TIMESTAMP WITH TIME ZONE,

  -- Notes
  notes TEXT,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES staff(id) ON DELETE SET NULL,

  UNIQUE(pipeline_project_id, approval_type_id)
);

-- Indexes for pipeline_project_approvals
CREATE INDEX IF NOT EXISTS idx_ppa_project ON pipeline_project_approvals(pipeline_project_id);
CREATE INDEX IF NOT EXISTS idx_ppa_type ON pipeline_project_approvals(approval_type_id);
CREATE INDEX IF NOT EXISTS idx_ppa_status ON pipeline_project_approvals(status);
CREATE INDEX IF NOT EXISTS idx_ppa_expiry ON pipeline_project_approvals(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ppa_followup ON pipeline_project_approvals(next_followup_date) WHERE next_followup_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ppa_internal ON pipeline_project_approvals(internal_status) WHERE internal_status != 'ops_approved';

-- ============================================================================
-- 4. APPROVAL DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_approval_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  approval_id UUID NOT NULL REFERENCES pipeline_project_approvals(id) ON DELETE CASCADE,
  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,

  document_type VARCHAR(50) NOT NULL,
  -- 'application_form', 'supporting_doc', 'site_plan', 'route_map',
  -- 'approval_certificate', 'rejection_letter', 'conditions_doc',
  -- 'fee_receipt', 'correspondence', 'appeal_doc', 'other'
  document_name VARCHAR(255) NOT NULL,
  description TEXT,

  -- File details
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  file_url VARCHAR(500),
  file_size INTEGER,
  mime_type VARCHAR(100),

  -- Document dates
  document_date DATE,
  issue_date DATE,
  expiry_date DATE,

  -- Reference
  reference_number VARCHAR(100),
  issuing_authority VARCHAR(255),

  -- Verification
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  verification_notes TEXT,

  -- Audit
  uploaded_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- Indexes for pipeline_approval_documents
CREATE INDEX IF NOT EXISTS idx_pad_approval ON pipeline_approval_documents(approval_id);
CREATE INDEX IF NOT EXISTS idx_pad_project ON pipeline_approval_documents(pipeline_project_id);
CREATE INDEX IF NOT EXISTS idx_pad_type ON pipeline_approval_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_pad_expiry ON pipeline_approval_documents(expiry_date) WHERE expiry_date IS NOT NULL;

-- ============================================================================
-- 5. EXPIRY ALERTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_expiry_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  approval_id UUID NOT NULL REFERENCES pipeline_project_approvals(id) ON DELETE CASCADE,
  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,

  alert_type VARCHAR(20) NOT NULL, -- '90_day', '30_day', '7_day', 'expired'
  alert_date DATE NOT NULL,
  expiry_date DATE NOT NULL,

  -- Notification tracking
  is_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMP WITH TIME ZONE,
  sent_to JSONB DEFAULT '[]'::jsonb, -- [{user_id, email, method, sent_at}]
  send_error TEXT,

  -- Acknowledgement
  acknowledged_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  action_taken TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for pipeline_expiry_alerts
CREATE INDEX IF NOT EXISTS idx_pea_unsent ON pipeline_expiry_alerts(alert_date) WHERE is_sent = false;
CREATE INDEX IF NOT EXISTS idx_pea_project ON pipeline_expiry_alerts(pipeline_project_id);
CREATE INDEX IF NOT EXISTS idx_pea_approval ON pipeline_expiry_alerts(approval_id);

-- ============================================================================
-- 6. TRIGGER: Auto-create expiry alerts
-- ============================================================================

CREATE OR REPLACE FUNCTION create_pipeline_expiry_alerts()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete existing alerts for this approval
  DELETE FROM pipeline_expiry_alerts WHERE approval_id = NEW.id;

  -- Only create alerts if expiry_date is set and status is approved
  IF NEW.expiry_date IS NOT NULL AND NEW.status IN ('approved', 'conditionally_approved', 'renewed') THEN
    -- 90-day alert
    IF NEW.expiry_date - INTERVAL '90 days' >= CURRENT_DATE THEN
      INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
      VALUES (NEW.id, NEW.pipeline_project_id, '90_day', NEW.expiry_date - INTERVAL '90 days', NEW.expiry_date);
    END IF;

    -- 30-day alert
    IF NEW.expiry_date - INTERVAL '30 days' >= CURRENT_DATE THEN
      INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
      VALUES (NEW.id, NEW.pipeline_project_id, '30_day', NEW.expiry_date - INTERVAL '30 days', NEW.expiry_date);
    END IF;

    -- 7-day alert
    IF NEW.expiry_date - INTERVAL '7 days' >= CURRENT_DATE THEN
      INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
      VALUES (NEW.id, NEW.pipeline_project_id, '7_day', NEW.expiry_date - INTERVAL '7 days', NEW.expiry_date);
    END IF;

    -- Expired alert (on expiry date)
    INSERT INTO pipeline_expiry_alerts (approval_id, pipeline_project_id, alert_type, alert_date, expiry_date)
    VALUES (NEW.id, NEW.pipeline_project_id, 'expired', NEW.expiry_date, NEW.expiry_date);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pipeline_expiry_alerts ON pipeline_project_approvals;
CREATE TRIGGER trg_pipeline_expiry_alerts
AFTER INSERT OR UPDATE OF expiry_date, status ON pipeline_project_approvals
FOR EACH ROW EXECUTE FUNCTION create_pipeline_expiry_alerts();

-- ============================================================================
-- 7. ACTIVITY LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  pipeline_project_id UUID NOT NULL REFERENCES pipeline_projects(id) ON DELETE CASCADE,
  approval_id UUID REFERENCES pipeline_project_approvals(id) ON DELETE SET NULL,

  action VARCHAR(50) NOT NULL,
  -- 'project_created', 'project_updated', 'status_changed',
  -- 'approval_added', 'approval_updated', 'approval_submitted', 'approval_approved',
  -- 'approval_rejected', 'internal_pm_approved', 'internal_ops_approved', 'internal_rejected',
  -- 'document_uploaded', 'document_verified', 'followup_scheduled', 'followup_completed',
  -- 'po_received', 'transitioned_to_planned',
  -- 'synced_from_smartsheet', 'sync_conflict_resolved', 'manual_override'

  action_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Change details
  old_value JSONB,
  new_value JSONB,
  field_changed VARCHAR(100),
  notes TEXT,

  -- Source
  source VARCHAR(20) DEFAULT 'manual', -- 'manual', 'smartsheet_sync', 'system', 'api', 'cron'

  -- Related entity
  related_entity_type VARCHAR(50), -- 'document', 'approval', 'alert'
  related_entity_id UUID,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for pipeline_activity_log
CREATE INDEX IF NOT EXISTS idx_pal_project ON pipeline_activity_log(pipeline_project_id);
CREATE INDEX IF NOT EXISTS idx_pal_approval ON pipeline_activity_log(approval_id) WHERE approval_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pal_action ON pipeline_activity_log(action);
CREATE INDEX IF NOT EXISTS idx_pal_date ON pipeline_activity_log(action_at);
CREATE INDEX IF NOT EXISTS idx_pal_user ON pipeline_activity_log(action_by) WHERE action_by IS NOT NULL;

-- ============================================================================
-- 8. SMARTSHEET SYNC CONFIGURATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS smartsheet_sync_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Sheet identification
  sheet_id VARCHAR(100) NOT NULL UNIQUE,
  sheet_name VARCHAR(255),
  workspace_id VARCHAR(100),
  workspace_name VARCHAR(255),

  -- Sync settings
  is_active BOOLEAN DEFAULT true,
  sync_direction VARCHAR(20) DEFAULT 'from_smartsheet', -- 'from_smartsheet', 'to_smartsheet', 'bidirectional'
  sync_frequency_minutes INTEGER DEFAULT 60,

  -- Last sync info
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_sync_status VARCHAR(20), -- 'success', 'partial', 'failed'
  last_sync_error TEXT,
  last_sync_rows_processed INTEGER,

  -- Column mappings
  column_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
  /* Structure:
  {
    "project_name": {"ss_column_id": "123456", "ss_column_name": "Project Name", "ss_column_type": "TEXT_NUMBER"},
    "province": {"ss_column_id": "123457", "ss_column_name": "Province", "ss_column_type": "PICKLIST"},
    "wayleave_eskom_status": {"ss_column_id": "123458", "ss_column_name": "Eskom Status", "approval_type": "wayleave_eskom", "field": "status"},
    "wayleave_eskom_expiry": {"ss_column_id": "123459", "ss_column_name": "Eskom Expiry", "approval_type": "wayleave_eskom", "field": "expiry_date"}
  }
  */

  -- Status value mappings (SS values to our status values)
  status_mappings JSONB DEFAULT '{}'::jsonb,
  /* Example:
  {
    "In Progress": "approvals_in_progress",
    "Approved": "approved",
    "Pending": "in_review"
  }
  */

  -- Row filtering
  filter_column_id VARCHAR(100),
  filter_values JSONB, -- Only sync rows where column matches these values

  -- API credentials reference (actual token stored securely)
  api_token_env_var VARCHAR(100) DEFAULT 'SMARTSHEET_API_TOKEN',

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES staff(id) ON DELETE SET NULL
);

-- ============================================================================
-- 9. SMARTSHEET SYNC HISTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS smartsheet_sync_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  config_id UUID NOT NULL REFERENCES smartsheet_sync_config(id) ON DELETE CASCADE,

  -- Timing
  sync_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  sync_completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,

  -- Status
  status VARCHAR(20) DEFAULT 'running', -- 'running', 'completed', 'failed', 'partial', 'cancelled'

  -- Statistics
  rows_processed INTEGER DEFAULT 0,
  rows_created INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0,
  rows_errored INTEGER DEFAULT 0,

  -- Details
  error_details JSONB DEFAULT '[]'::jsonb, -- [{row_id, ss_row_id, error, field}]
  warnings JSONB DEFAULT '[]'::jsonb,
  sync_log TEXT,

  -- Trigger info
  triggered_by VARCHAR(20) DEFAULT 'manual', -- 'scheduled', 'manual', 'webhook', 'api'
  triggered_by_user UUID REFERENCES staff(id) ON DELETE SET NULL
);

-- Index for sync history
CREATE INDEX IF NOT EXISTS idx_ssh_config ON smartsheet_sync_history(config_id);
CREATE INDEX IF NOT EXISTS idx_ssh_started ON smartsheet_sync_history(sync_started_at);

-- ============================================================================
-- 10. HELPER VIEWS
-- ============================================================================

-- View: Pipeline projects with approval summary
CREATE OR REPLACE VIEW pipeline_projects_summary AS
SELECT
  p.*,
  c.company_name AS client_name,
  pm.first_name || ' ' || pm.last_name AS project_manager_name,
  wo.first_name || ' ' || wo.last_name AS wayleaves_officer_name,
  (
    SELECT COUNT(*)
    FROM pipeline_project_approvals a
    WHERE a.pipeline_project_id = p.id AND a.is_required = true
  ) AS total_required_approvals,
  (
    SELECT COUNT(*)
    FROM pipeline_project_approvals a
    WHERE a.pipeline_project_id = p.id
      AND a.is_required = true
      AND a.status IN ('approved', 'conditionally_approved')
  ) AS completed_approvals,
  (
    SELECT COUNT(*)
    FROM pipeline_project_approvals a
    WHERE a.pipeline_project_id = p.id
      AND a.is_required = true
      AND a.expiry_date IS NOT NULL
      AND a.expiry_date < CURRENT_DATE
  ) AS expired_approvals,
  (
    SELECT MIN(a.expiry_date)
    FROM pipeline_project_approvals a
    WHERE a.pipeline_project_id = p.id
      AND a.status IN ('approved', 'conditionally_approved')
      AND a.expiry_date IS NOT NULL
  ) AS earliest_expiry_date
FROM pipeline_projects p
LEFT JOIN clients c ON p.client_id = c.id
LEFT JOIN staff pm ON p.project_manager_id = pm.id
LEFT JOIN staff wo ON p.wayleaves_officer_id = wo.id
WHERE p.is_deleted = false;

-- View: Expiring approvals (next 90 days)
CREATE OR REPLACE VIEW pipeline_expiring_approvals AS
SELECT
  a.*,
  t.code AS approval_type_code,
  t.name AS approval_type_name,
  p.project_code,
  p.project_name,
  p.client_id,
  c.company_name AS client_name,
  p.project_manager_id,
  p.wayleaves_officer_id,
  a.expiry_date - CURRENT_DATE AS days_until_expiry,
  CASE
    WHEN a.expiry_date < CURRENT_DATE THEN 'expired'
    WHEN a.expiry_date - CURRENT_DATE <= 7 THEN 'critical'
    WHEN a.expiry_date - CURRENT_DATE <= 30 THEN 'warning'
    WHEN a.expiry_date - CURRENT_DATE <= 90 THEN 'upcoming'
    ELSE 'ok'
  END AS urgency
FROM pipeline_project_approvals a
JOIN pipeline_approval_types t ON a.approval_type_id = t.id
JOIN pipeline_projects p ON a.pipeline_project_id = p.id
LEFT JOIN clients c ON p.client_id = c.id
WHERE a.status IN ('approved', 'conditionally_approved', 'renewed')
  AND a.expiry_date IS NOT NULL
  AND a.expiry_date <= CURRENT_DATE + INTERVAL '90 days'
  AND p.is_deleted = false
  AND p.pipeline_status NOT IN ('planned', 'cancelled', 'lost')
ORDER BY a.expiry_date ASC;

-- View: Due follow-ups
CREATE OR REPLACE VIEW pipeline_due_followups AS
SELECT
  a.*,
  t.code AS approval_type_code,
  t.name AS approval_type_name,
  p.project_code,
  p.project_name,
  p.project_manager_id,
  p.wayleaves_officer_id,
  a.next_followup_date - CURRENT_DATE AS days_until_followup,
  CASE
    WHEN a.next_followup_date < CURRENT_DATE THEN 'overdue'
    WHEN a.next_followup_date = CURRENT_DATE THEN 'today'
    WHEN a.next_followup_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'upcoming'
    ELSE 'scheduled'
  END AS followup_status
FROM pipeline_project_approvals a
JOIN pipeline_approval_types t ON a.approval_type_id = t.id
JOIN pipeline_projects p ON a.pipeline_project_id = p.id
WHERE a.next_followup_date IS NOT NULL
  AND a.status NOT IN ('approved', 'rejected', 'withdrawn', 'expired')
  AND p.is_deleted = false
  AND p.pipeline_status NOT IN ('planned', 'cancelled', 'lost')
ORDER BY a.next_followup_date ASC;

-- ============================================================================
-- 11. TRIGGER: Update project timestamp on changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_pipeline_project_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE pipeline_projects
  SET updated_at = NOW()
  WHERE id = NEW.pipeline_project_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_project_on_approval_change ON pipeline_project_approvals;
CREATE TRIGGER trg_update_project_on_approval_change
AFTER INSERT OR UPDATE ON pipeline_project_approvals
FOR EACH ROW EXECUTE FUNCTION update_pipeline_project_timestamp();

DROP TRIGGER IF EXISTS trg_update_project_on_document_change ON pipeline_approval_documents;
CREATE TRIGGER trg_update_project_on_document_change
AFTER INSERT OR UPDATE ON pipeline_approval_documents
FOR EACH ROW EXECUTE FUNCTION update_pipeline_project_timestamp();

-- ============================================================================
-- 12. PROJECT CODE SEQUENCE
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS pipeline_project_code_seq START 1000;

CREATE OR REPLACE FUNCTION generate_pipeline_project_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.project_code IS NULL OR NEW.project_code = '' THEN
    NEW.project_code := 'PL-' || LPAD(nextval('pipeline_project_code_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_pipeline_code ON pipeline_projects;
CREATE TRIGGER trg_generate_pipeline_code
BEFORE INSERT ON pipeline_projects
FOR EACH ROW EXECUTE FUNCTION generate_pipeline_project_code();

-- ============================================================================
-- GRANT PERMISSIONS (adjust role name as needed)
-- ============================================================================

-- For Neon, permissions are typically handled at the connection level
-- If needed, uncomment and adjust:
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO neondb_owner;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO neondb_owner;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Verify tables created
DO $$
DECLARE
  table_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO table_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'pipeline_approval_types',
      'pipeline_projects',
      'pipeline_project_approvals',
      'pipeline_approval_documents',
      'pipeline_expiry_alerts',
      'pipeline_activity_log',
      'smartsheet_sync_config',
      'smartsheet_sync_history'
    );

  IF table_count = 8 THEN
    RAISE NOTICE 'Migration 108_pipeline_management: SUCCESS - All 8 tables created';
  ELSE
    RAISE WARNING 'Migration 108_pipeline_management: Only % of 8 tables created', table_count;
  END IF;
END $$;
