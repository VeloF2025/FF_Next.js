-- Migration: OLT Investigation Workflow
-- Date: 2026-01-25
-- Description: Add columns for investigation workflow, escalation, and resolution tracking

-- Add resolution and escalation columns to olt_mismatch_records
ALTER TABLE olt_mismatch_records
  ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
  ADD COLUMN IF NOT EXISTS escalated_to UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);

-- Add index for escalation queries
CREATE INDEX IF NOT EXISTS idx_olt_mismatch_escalated_to ON olt_mismatch_records(escalated_to) WHERE escalated_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_olt_mismatch_resolution_type ON olt_mismatch_records(resolution_type) WHERE resolution_type IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN olt_mismatch_records.resolution_type IS 'Resolution type: manually_fixed, closed_invalid, closed_no_data, closed_false_positive, escalated';
COMMENT ON COLUMN olt_mismatch_records.resolution_notes IS 'Notes explaining the resolution or investigation findings';
COMMENT ON COLUMN olt_mismatch_records.escalated_to IS 'User ID of admin the record was escalated to';
COMMENT ON COLUMN olt_mismatch_records.escalated_at IS 'Timestamp when record was escalated';
COMMENT ON COLUMN olt_mismatch_records.escalated_by IS 'User ID who escalated the record';
COMMENT ON COLUMN olt_mismatch_records.resolved_at IS 'Timestamp when investigation was resolved';
COMMENT ON COLUMN olt_mismatch_records.resolved_by IS 'User ID who resolved the investigation';

-- Update fix_status enum to include investigation states
-- First check what values currently exist
-- Valid values: pending, fixed, empty_serial, not_found, needs_reinvestigation, investigating, resolved, escalated

-- Verification query (run after migration)
-- SELECT resolution_type, COUNT(*) FROM olt_mismatch_records GROUP BY resolution_type;
-- SELECT escalated_to IS NOT NULL as has_escalation, COUNT(*) FROM olt_mismatch_records GROUP BY escalated_to IS NOT NULL;
