-- Migration 273: Create maintenance_qa_checks table and add QA readiness columns to maintenance_tickets
-- Fixes NOC DevOps ticket VF-20260409-011: QA Readiness Status Failed to Load

-- 1. Add qa_ready and qa_readiness_check_at columns to maintenance_tickets
ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS qa_ready BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS qa_readiness_check_at TIMESTAMP;

COMMENT ON COLUMN maintenance_tickets.qa_ready IS 'Boolean flag indicating if ticket passes pre-QA readiness validation';
COMMENT ON COLUMN maintenance_tickets.qa_readiness_check_at IS 'Timestamp of last QA readiness check';

-- 2. Create maintenance_qa_checks table (the NOC module pre-QA validation log)
CREATE TABLE IF NOT EXISTS maintenance_qa_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES maintenance_tickets(id) ON DELETE CASCADE,

  -- Overall result
  passed BOOLEAN NOT NULL,
  checked_at TIMESTAMP DEFAULT NOW(),
  checked_by UUID REFERENCES users(id),

  -- Individual check results
  photos_exist BOOLEAN,
  photos_count INTEGER,
  photos_required_count INTEGER,
  dr_populated BOOLEAN,
  pole_populated BOOLEAN,
  pon_populated BOOLEAN,
  zone_populated BOOLEAN,
  ont_serial_recorded BOOLEAN,
  ont_rx_recorded BOOLEAN,
  platforms_aligned BOOLEAN,

  -- Failure details
  failed_checks JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE maintenance_qa_checks IS 'Pre-QA validation checks to ensure NOC tickets are ready for QA review';
COMMENT ON COLUMN maintenance_qa_checks.passed IS 'Overall pass/fail status of the readiness check';
COMMENT ON COLUMN maintenance_qa_checks.checked_by IS 'User who ran the check; NULL for system-triggered checks';
COMMENT ON COLUMN maintenance_qa_checks.failed_checks IS 'JSON array of failed check objects with name and reason fields';

-- 3. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_maint_qa_checks_ticket
  ON maintenance_qa_checks(ticket_id);

CREATE INDEX IF NOT EXISTS idx_maint_qa_checks_checked_at
  ON maintenance_qa_checks(checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_maint_qa_checks_passed
  ON maintenance_qa_checks(passed);
