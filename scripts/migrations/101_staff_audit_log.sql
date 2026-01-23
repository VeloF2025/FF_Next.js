-- Staff Audit Log Table
-- Tracks all actions performed on staff records for compliance and auditing

CREATE TABLE IF NOT EXISTS staff_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

  -- Action details
  action_type VARCHAR(50) NOT NULL,  -- document_uploaded, document_verified, profile_updated, data_exported, etc.
  action_description TEXT NOT NULL,   -- Human-readable description

  -- What changed
  details JSONB DEFAULT '{}',         -- Action-specific details (old/new values, document info, etc.)

  -- Who performed the action
  performed_by UUID,                  -- User ID (can be null for system actions)
  performed_by_name VARCHAR(255),     -- Denormalized name for quick display

  -- Context
  ip_address VARCHAR(45),             -- IPv4 or IPv6
  user_agent TEXT,                    -- Browser/client info

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_staff_audit_log_staff_id ON staff_audit_log(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_audit_log_action_type ON staff_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_staff_audit_log_performed_by ON staff_audit_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_staff_audit_log_created_at ON staff_audit_log(created_at DESC);

-- Action types reference:
-- Document actions:
--   document_uploaded    - New document uploaded
--   document_verified    - Document verified with OCR data
--   document_rejected    - Document verification rejected
--   document_deleted     - Document removed
--   document_downloaded  - Document file downloaded
--
-- Profile actions:
--   profile_created      - Staff record created
--   profile_updated      - Staff details edited
--   profile_viewed       - Staff profile viewed (optional, can be noisy)
--   profile_deleted      - Staff record deleted/archived
--
-- Data actions:
--   data_exported        - Staff data exported (CSV, Excel, etc.)
--   report_generated     - Report containing staff data generated
--
-- Access actions:
--   permission_changed   - Access permissions modified
--   note_added           - Note added to staff record
--   note_deleted         - Note deleted from staff record

COMMENT ON TABLE staff_audit_log IS 'Audit trail for all actions performed on staff records';
