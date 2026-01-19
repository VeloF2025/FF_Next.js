-- Ticketing Module - Maintenance Enhancement Tables Migration
-- Creates 4 maintenance enhancement tables for QA readiness, risk acceptance, handovers, and escalations
--
-- Tables created:
--   9. qa_readiness_checks - Pre-QA validation log
--  10. qa_risk_acceptances - Conditional approval tracking
--  11. handover_snapshots - Immutable audit trail
--  12. repeat_fault_escalations - Infrastructure-level escalation

-- Depends on: 001_create_core_tables.sql (tickets table must exist)

-- 9. qa_readiness_checks - Pre-QA validation log
CREATE TABLE IF NOT EXISTS qa_readiness_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,

  -- Check results
  passed BOOLEAN NOT NULL,
  checked_at TIMESTAMP DEFAULT NOW(),
  checked_by UUID, -- NULL for system checks

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
  platforms_aligned BOOLEAN, -- SP, SOW, tracker all match

  -- Failure details
  failed_checks JSONB, -- Array of failed check names with reasons

  created_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE qa_readiness_checks IS 'Pre-QA validation checks to ensure tickets are ready for QA review';
COMMENT ON COLUMN qa_readiness_checks.passed IS 'Overall pass/fail status of the readiness check';
COMMENT ON COLUMN qa_readiness_checks.photos_exist IS 'Check if required photos are uploaded';
COMMENT ON COLUMN qa_readiness_checks.platforms_aligned IS 'Check if data matches across SharePoint, SOW, and tracker systems';
COMMENT ON COLUMN qa_readiness_checks.failed_checks IS 'JSON array of failed check names with specific failure reasons';

-- 10. qa_risk_acceptances - Conditional approval tracking
CREATE TABLE IF NOT EXISTS qa_risk_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,

  -- Risk details
  risk_type VARCHAR(50) NOT NULL, -- 'minor_defect', 'documentation_gap', 'pending_material', etc.
  risk_description TEXT NOT NULL,
  conditions TEXT, -- What must be resolved

  -- Expiry
  risk_expiry_date DATE, -- When condition must be resolved
  requires_followup BOOLEAN DEFAULT true,
  followup_date DATE,

  -- Status
  status VARCHAR(20) DEFAULT 'active',
  resolved_at TIMESTAMP,
  resolved_by UUID,
  resolution_notes TEXT,

  -- Approval
  accepted_by UUID NOT NULL,
  accepted_at TIMESTAMP DEFAULT NOW(),

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (status IN ('active', 'resolved', 'expired', 'escalated'))
);

COMMENT ON TABLE qa_risk_acceptances IS 'QA risk acceptances for conditional approvals with documented exceptions';
COMMENT ON COLUMN qa_risk_acceptances.risk_type IS 'Type of risk being accepted: minor_defect, documentation_gap, pending_material, etc.';
COMMENT ON COLUMN qa_risk_acceptances.conditions IS 'Conditions that must be met to resolve the risk';
COMMENT ON COLUMN qa_risk_acceptances.risk_expiry_date IS 'Date by which the condition must be resolved';
COMMENT ON COLUMN qa_risk_acceptances.requires_followup IS 'Whether the risk requires follow-up review';

-- 11. handover_snapshots - Immutable audit trail
CREATE TABLE IF NOT EXISTS handover_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL,

  -- Handover type
  handover_type VARCHAR(30) NOT NULL,

  -- Snapshot data (immutable record of state at handover)
  snapshot_data JSONB NOT NULL, -- Full ticket state at handover
  evidence_links JSONB, -- All photo/document URLs
  decisions JSONB, -- All approval/rejection records
  guarantee_status VARCHAR(20),

  -- Ownership change
  from_owner_type VARCHAR(20), -- 'build', 'qa', 'maintenance'
  from_owner_id UUID,
  to_owner_type VARCHAR(20),
  to_owner_id UUID,

  -- Audit
  handover_at TIMESTAMP DEFAULT NOW(),
  handover_by UUID NOT NULL,

  -- Lock status
  is_locked BOOLEAN DEFAULT true,

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (handover_type IN ('build_to_qa', 'qa_to_maintenance', 'maintenance_complete')),
  CHECK (from_owner_type IN ('build', 'qa', 'maintenance') OR from_owner_type IS NULL),
  CHECK (to_owner_type IN ('build', 'qa', 'maintenance') OR to_owner_type IS NULL)
);

COMMENT ON TABLE handover_snapshots IS 'Immutable snapshots of ticket state at handover points (Build → QA → Maintenance)';
COMMENT ON COLUMN handover_snapshots.handover_type IS 'Type of handover: build_to_qa, qa_to_maintenance, maintenance_complete';
COMMENT ON COLUMN handover_snapshots.snapshot_data IS 'Full immutable JSON snapshot of ticket data at handover time';
COMMENT ON COLUMN handover_snapshots.evidence_links IS 'JSON array of all photo and document URLs at handover';
COMMENT ON COLUMN handover_snapshots.decisions IS 'JSON array of all QA approval/rejection decisions';
COMMENT ON COLUMN handover_snapshots.is_locked IS 'Whether snapshot is locked (should always be true - immutable)';

-- 12. repeat_fault_escalations - Infrastructure-level escalation
CREATE TABLE IF NOT EXISTS repeat_fault_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Escalation scope
  scope_type VARCHAR(20) NOT NULL,
  scope_value VARCHAR(100) NOT NULL, -- The pole number, PON, zone ID, or DR
  project_id UUID,

  -- Trigger info
  fault_count INTEGER NOT NULL, -- Number of faults that triggered escalation
  fault_threshold INTEGER NOT NULL, -- Threshold that was exceeded
  contributing_tickets JSONB, -- Array of ticket IDs that contributed

  -- Escalation
  escalation_ticket_id UUID, -- The infrastructure ticket created
  escalation_type VARCHAR(30), -- 'investigation', 'inspection', 'replacement'

  -- Status
  status VARCHAR(20) DEFAULT 'open',
  resolution_notes TEXT,
  resolved_at TIMESTAMP,
  resolved_by UUID,

  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (scope_type IN ('pole', 'pon', 'zone', 'dr')),
  CHECK (escalation_type IN ('investigation', 'inspection', 'replacement') OR escalation_type IS NULL),
  CHECK (status IN ('open', 'investigating', 'resolved', 'no_action'))
);

COMMENT ON TABLE repeat_fault_escalations IS 'Tracks repeat fault patterns and escalations to infrastructure-level tickets';
COMMENT ON COLUMN repeat_fault_escalations.scope_type IS 'Scope of escalation: pole, pon (PON number), zone, or dr (DR number)';
COMMENT ON COLUMN repeat_fault_escalations.scope_value IS 'The specific pole number, PON, zone ID, or DR number with repeat faults';
COMMENT ON COLUMN repeat_fault_escalations.fault_count IS 'Number of faults detected in this scope that triggered escalation';
COMMENT ON COLUMN repeat_fault_escalations.fault_threshold IS 'The threshold that was exceeded to trigger escalation';
COMMENT ON COLUMN repeat_fault_escalations.contributing_tickets IS 'JSON array of ticket UUIDs that contributed to this escalation';
COMMENT ON COLUMN repeat_fault_escalations.escalation_ticket_id IS 'UUID of the infrastructure-level ticket created for this escalation';
COMMENT ON COLUMN repeat_fault_escalations.escalation_type IS 'Type of escalation: investigation (analyze), inspection (site visit), replacement (infrastructure fix)';
