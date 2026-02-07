-- Migration: 110_qfield_qa_workflow
-- Purpose: Extend QField photo validations with full QA workflow capabilities
-- Date: 2026-02-07
-- Description: Adds manual review, assignment, escalation, and workflow tracking

-- ============================================================================
-- EXTEND: qfield_photo_validations with workflow fields
-- ============================================================================

-- Manual Review Fields
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  manual_status TEXT;                  -- 'approved', 'rejected', NULL
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  manual_reviewed_by TEXT;             -- User who reviewed
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  manual_reviewed_at TIMESTAMPTZ;      -- When reviewed
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  manual_notes TEXT;                   -- Review notes

-- Assignment Fields
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  assigned_to TEXT;                    -- Assigned reviewer
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  assigned_at TIMESTAMPTZ;             -- When assigned
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  due_date TIMESTAMPTZ;                -- Review deadline
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  priority TEXT DEFAULT 'normal';      -- low, normal, high, urgent

-- Escalation Fields
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  escalation_level INT DEFAULT 0;      -- 0=none, 1=supervisor, 2=manager
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  escalated_at TIMESTAMPTZ;
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  escalation_reason TEXT;

-- Workflow State
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  workflow_status TEXT DEFAULT 'pending';  -- pending, in_review, approved, rejected, escalated

-- File metadata
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  file_size_bytes BIGINT;
ALTER TABLE qfield_photo_validations ADD COLUMN IF NOT EXISTS
  file_modified_at TIMESTAMPTZ;

-- Add constraints for new fields
DO $$ BEGIN
  ALTER TABLE qfield_photo_validations
    ADD CONSTRAINT valid_manual_status CHECK (manual_status IN ('approved', 'rejected', NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE qfield_photo_validations
    ADD CONSTRAINT valid_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE qfield_photo_validations
    ADD CONSTRAINT valid_workflow_status CHECK (workflow_status IN ('pending', 'in_review', 'approved', 'rejected', 'escalated'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- INDEXES: Workflow queries
-- ============================================================================

-- Index for workflow status queries
CREATE INDEX IF NOT EXISTS idx_qfield_validations_workflow
  ON qfield_photo_validations(workflow_status, assigned_to);

-- Index for due date queries
CREATE INDEX IF NOT EXISTS idx_qfield_validations_due
  ON qfield_photo_validations(due_date)
  WHERE workflow_status IN ('pending', 'in_review');

-- Index for assignment queries
CREATE INDEX IF NOT EXISTS idx_qfield_validations_assigned
  ON qfield_photo_validations(assigned_to)
  WHERE assigned_to IS NOT NULL;

-- Index for escalation queries
CREATE INDEX IF NOT EXISTS idx_qfield_validations_escalated
  ON qfield_photo_validations(escalation_level)
  WHERE escalation_level > 0;

-- Index for priority filtering
CREATE INDEX IF NOT EXISTS idx_qfield_validations_priority
  ON qfield_photo_validations(priority, workflow_status);

-- ============================================================================
-- TABLE: qfield_qa_assignments (assignment history)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qfield_qa_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id UUID NOT NULL REFERENCES qfield_photo_validations(id) ON DELETE CASCADE,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  due_date TIMESTAMPTZ,
  priority TEXT DEFAULT 'normal',
  notes TEXT,
  completed_at TIMESTAMPTZ,

  CONSTRAINT valid_assignment_priority CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_qa_assignments_validation
  ON qfield_qa_assignments(validation_id);

CREATE INDEX IF NOT EXISTS idx_qa_assignments_assignee
  ON qfield_qa_assignments(assigned_to)
  WHERE completed_at IS NULL;

-- ============================================================================
-- TABLE: qfield_qa_actions (audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qfield_qa_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_id UUID NOT NULL REFERENCES qfield_photo_validations(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,  -- 'assign', 'approve', 'reject', 'escalate', 'revalidate', 'comment'
  action_by TEXT NOT NULL,
  action_at TIMESTAMPTZ DEFAULT NOW(),
  previous_value JSONB,
  new_value JSONB,
  notes TEXT,

  CONSTRAINT valid_action_type CHECK (action_type IN ('assign', 'approve', 'reject', 'escalate', 'revalidate', 'comment', 'status_change'))
);

CREATE INDEX IF NOT EXISTS idx_qa_actions_validation
  ON qfield_qa_actions(validation_id);

CREATE INDEX IF NOT EXISTS idx_qa_actions_type
  ON qfield_qa_actions(action_type);

CREATE INDEX IF NOT EXISTS idx_qa_actions_date
  ON qfield_qa_actions(action_at DESC);

-- ============================================================================
-- VIEW: v_qfield_qa_photos (joined view with feature context)
-- ============================================================================
CREATE OR REPLACE VIEW v_qfield_qa_photos AS
SELECT
  v.id,
  v.photo_key,
  v.feature_id,
  v.feature_type,
  v.work_type,
  v.project_id,
  v.vlm_confidence,
  v.vlm_feedback,
  v.vlm_raw_response,
  v.needs_retake,
  v.retake_notified_at,
  v.retake_completed_at,
  v.validated_at,
  v.created_at,
  -- Workflow fields
  v.manual_status,
  v.manual_reviewed_by,
  v.manual_reviewed_at,
  v.manual_notes,
  v.assigned_to,
  v.assigned_at,
  v.due_date,
  v.priority,
  v.escalation_level,
  v.escalated_at,
  v.escalation_reason,
  v.workflow_status,
  v.file_size_bytes,
  v.file_modified_at,
  -- Pole context (when feature_type = 'pole')
  p.type AS pole_type,
  p.height AS pole_height,
  p.material AS pole_material,
  p.status AS pole_status,
  p.latitude AS pole_latitude,
  p.longitude AS pole_longitude,
  p.address AS pole_address,
  p.images AS pole_images,
  -- Drop context (when feature_type = 'drop')
  d.drop_number,
  d.pole_number AS drop_pole_number,
  d.address AS drop_address,
  d.customer_name AS drop_customer_name,
  d.status AS drop_status,
  d.qc_status AS drop_qc_status,
  -- Project context
  qp.name AS qfield_project_name
FROM qfield_photo_validations v
LEFT JOIN poles p ON v.feature_type = 'pole' AND v.feature_id = p.pole_number
LEFT JOIN drops d ON v.feature_type = 'drop' AND v.feature_id = d.drop_number
LEFT JOIN qfield_projects qp ON v.project_id = qp.id;

COMMENT ON VIEW v_qfield_qa_photos IS
  'QField QA photos with joined feature context from poles and drops tables';

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN qfield_photo_validations.manual_status IS
  'Manual review status: approved, rejected, or NULL if not reviewed';

COMMENT ON COLUMN qfield_photo_validations.workflow_status IS
  'Current workflow state: pending, in_review, approved, rejected, escalated';

COMMENT ON COLUMN qfield_photo_validations.priority IS
  'Review priority: low, normal, high, urgent';

COMMENT ON COLUMN qfield_photo_validations.escalation_level IS
  'Escalation level: 0=none, 1=supervisor, 2=manager';

COMMENT ON TABLE qfield_qa_assignments IS
  'Assignment history for QField photo validation reviews';

COMMENT ON TABLE qfield_qa_actions IS
  'Audit trail for all QA actions (assign, approve, reject, escalate, etc.)';

-- ============================================================================
-- APPLIED STATUS
-- ============================================================================
-- Status: PENDING - Apply with:
-- psql $NEON_DATABASE_URL -f scripts/migrations/110_qfield_qa_workflow.sql
