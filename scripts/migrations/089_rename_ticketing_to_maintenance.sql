-- Migration 089: Rename Ticketing Module to Maintenance
-- This is a BREAKING CHANGE migration that renames all ticketing tables to maintenance
--
-- Tables renamed:
--   tickets -> maintenance_tickets
--   ticket_attachments -> maintenance_attachments
--   ticket_notes -> maintenance_notes
--   verification_steps -> maintenance_verification_steps
--   weekly_reports -> maintenance_weekly_reports
--   qcontact_sync_log -> maintenance_qcontact_sync_log
--   guarantee_periods -> maintenance_guarantee_periods
--   whatsapp_notifications -> maintenance_whatsapp_notifications
--   qa_readiness_checks -> maintenance_qa_checks
--   qa_risk_acceptances -> maintenance_risk_acceptances
--   handover_snapshots -> maintenance_handover_snapshots
--   repeat_fault_escalations -> maintenance_escalations
--
-- Enum value changes:
--   type: 'maintenance' -> 'fault_repair'
--   ticket_status: 'handed_to_maintenance' -> 'handed_to_ops'
--   owner_type: 'maintenance' -> 'ops'
--   handover_type: 'qa_to_maintenance' -> 'qa_to_ops', 'maintenance_complete' -> 'ops_complete'

BEGIN;

-- =============================================================================
-- STEP 1: RENAME CORE TABLES
-- =============================================================================

ALTER TABLE IF EXISTS tickets RENAME TO maintenance_tickets;
ALTER TABLE IF EXISTS ticket_attachments RENAME TO maintenance_attachments;
ALTER TABLE IF EXISTS ticket_notes RENAME TO maintenance_notes;
ALTER TABLE IF EXISTS verification_steps RENAME TO maintenance_verification_steps;

-- =============================================================================
-- STEP 2: RENAME INTEGRATION TABLES
-- =============================================================================

ALTER TABLE IF EXISTS weekly_reports RENAME TO maintenance_weekly_reports;
ALTER TABLE IF EXISTS qcontact_sync_log RENAME TO maintenance_qcontact_sync_log;
ALTER TABLE IF EXISTS guarantee_periods RENAME TO maintenance_guarantee_periods;
ALTER TABLE IF EXISTS whatsapp_notifications RENAME TO maintenance_whatsapp_notifications;

-- =============================================================================
-- STEP 3: RENAME QA/MAINTENANCE ENHANCEMENT TABLES
-- =============================================================================

ALTER TABLE IF EXISTS qa_readiness_checks RENAME TO maintenance_qa_checks;
ALTER TABLE IF EXISTS qa_risk_acceptances RENAME TO maintenance_risk_acceptances;
ALTER TABLE IF EXISTS handover_snapshots RENAME TO maintenance_handover_snapshots;
ALTER TABLE IF EXISTS repeat_fault_escalations RENAME TO maintenance_escalations;

-- =============================================================================
-- STEP 4: DROP TYPE AND STATUS CHECK CONSTRAINTS (before updating values)
-- =============================================================================

-- Drop type check constraint to allow updating values
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS tickets_type_check;
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_type_check;

-- Drop status check constraint to allow updating values
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_status_check;

-- =============================================================================
-- STEP 5: UPDATE ENUM VALUES IN DATA
-- =============================================================================

-- Update type: 'maintenance' -> 'fault_repair'
UPDATE maintenance_tickets SET type = 'fault_repair' WHERE type = 'maintenance';

-- Update ticket status: 'handed_to_maintenance' -> 'handed_to_ops'
UPDATE maintenance_tickets SET status = 'handed_to_ops' WHERE status = 'handed_to_maintenance';

-- =============================================================================
-- STEP 6: RECREATE TYPE AND STATUS CHECK CONSTRAINTS (with new values)
-- =============================================================================

-- Recreate type constraint with all existing + new values
-- Existing DB values: fault, installation, maintenance, other
-- New TypeScript enum values: fault_repair, new_installation, modification, ont_swap, incident
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_type_check
  CHECK (type IN ('fault', 'fault_repair', 'installation', 'new_installation', 'modification', 'ont_swap', 'incident', 'other'));

-- Recreate status constraint with all existing + new values
-- Existing DB values: closed, 'in progress', new, 'pending company', resolved, triaged
-- New TypeScript enum values: open, assigned, in_progress, pending_qa, qa_in_progress, etc.
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_status_check
  CHECK (status IN ('open', 'new', 'assigned', 'in_progress', 'in progress', 'pending_qa', 'qa_in_progress', 'qa_rejected', 'qa_approved', 'pending_handover', 'handed_to_ops', 'handed_to_maintenance', 'closed', 'cancelled', 'pending_parts', 'pending company', 'on_hold', 'qa_ready', 'qa_failed', 'resolved', 'reopened', 'triaged'));

-- Update handover_snapshots owner types: 'maintenance' -> 'ops'
UPDATE maintenance_handover_snapshots SET from_owner_type = 'ops' WHERE from_owner_type = 'maintenance';
UPDATE maintenance_handover_snapshots SET to_owner_type = 'ops' WHERE to_owner_type = 'maintenance';

-- Update handover_type: 'qa_to_maintenance' -> 'qa_to_ops', 'maintenance_complete' -> 'ops_complete'
UPDATE maintenance_handover_snapshots SET handover_type = 'qa_to_ops' WHERE handover_type = 'qa_to_maintenance';
UPDATE maintenance_handover_snapshots SET handover_type = 'ops_complete' WHERE handover_type = 'maintenance_complete';

-- =============================================================================
-- STEP 5: UPDATE CHECK CONSTRAINTS ON HANDOVER_SNAPSHOTS
-- =============================================================================

-- Drop old constraints
ALTER TABLE maintenance_handover_snapshots DROP CONSTRAINT IF EXISTS handover_snapshots_handover_type_check;
ALTER TABLE maintenance_handover_snapshots DROP CONSTRAINT IF EXISTS handover_snapshots_from_owner_type_check;
ALTER TABLE maintenance_handover_snapshots DROP CONSTRAINT IF EXISTS handover_snapshots_to_owner_type_check;

-- Add new constraints with updated values
ALTER TABLE maintenance_handover_snapshots ADD CONSTRAINT maintenance_handover_snapshots_handover_type_check
  CHECK (handover_type IN ('build_to_qa', 'qa_to_ops', 'ops_complete'));

ALTER TABLE maintenance_handover_snapshots ADD CONSTRAINT maintenance_handover_snapshots_from_owner_type_check
  CHECK (from_owner_type IN ('build', 'qa', 'ops') OR from_owner_type IS NULL);

ALTER TABLE maintenance_handover_snapshots ADD CONSTRAINT maintenance_handover_snapshots_to_owner_type_check
  CHECK (to_owner_type IN ('build', 'qa', 'ops') OR to_owner_type IS NULL);

-- =============================================================================
-- STEP 6: RENAME INDEXES - TICKETS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_tickets_ticket_uid RENAME TO idx_maintenance_tickets_ticket_uid;
ALTER INDEX IF EXISTS idx_tickets_dr RENAME TO idx_maintenance_tickets_dr;
ALTER INDEX IF EXISTS idx_tickets_status RENAME TO idx_maintenance_tickets_status;
ALTER INDEX IF EXISTS idx_tickets_priority RENAME TO idx_maintenance_tickets_priority;
ALTER INDEX IF EXISTS idx_tickets_ticket_type RENAME TO idx_maintenance_tickets_ticket_type;
ALTER INDEX IF EXISTS idx_tickets_project RENAME TO idx_maintenance_tickets_project;
ALTER INDEX IF EXISTS idx_tickets_assigned RENAME TO idx_maintenance_tickets_assigned;
ALTER INDEX IF EXISTS idx_tickets_contractor RENAME TO idx_maintenance_tickets_contractor;
ALTER INDEX IF EXISTS idx_tickets_pole RENAME TO idx_maintenance_tickets_pole;
ALTER INDEX IF EXISTS idx_tickets_pon RENAME TO idx_maintenance_tickets_pon;
ALTER INDEX IF EXISTS idx_tickets_zone RENAME TO idx_maintenance_tickets_zone;
ALTER INDEX IF EXISTS idx_tickets_sla RENAME TO idx_maintenance_tickets_sla;
ALTER INDEX IF EXISTS idx_tickets_created_at RENAME TO idx_maintenance_tickets_created_at;
ALTER INDEX IF EXISTS idx_tickets_closed_at RENAME TO idx_maintenance_tickets_closed_at;
ALTER INDEX IF EXISTS idx_tickets_qa_ready RENAME TO idx_maintenance_tickets_qa_ready;
ALTER INDEX IF EXISTS idx_tickets_fault_cause RENAME TO idx_maintenance_tickets_fault_cause;
ALTER INDEX IF EXISTS idx_tickets_source RENAME TO idx_maintenance_tickets_source;
ALTER INDEX IF EXISTS idx_tickets_external_id RENAME TO idx_maintenance_tickets_external_id;
ALTER INDEX IF EXISTS idx_tickets_guarantee_status RENAME TO idx_maintenance_tickets_guarantee_status;
ALTER INDEX IF EXISTS idx_tickets_status_priority_assigned RENAME TO idx_maintenance_tickets_status_priority_assigned;
ALTER INDEX IF EXISTS idx_tickets_project_status RENAME TO idx_maintenance_tickets_project_status;

-- =============================================================================
-- STEP 7: RENAME INDEXES - VERIFICATION_STEPS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_verification_ticket RENAME TO idx_maintenance_verification_ticket;
ALTER INDEX IF EXISTS idx_verification_step_number RENAME TO idx_maintenance_verification_step_number;
ALTER INDEX IF EXISTS idx_verification_complete RENAME TO idx_maintenance_verification_complete;

-- =============================================================================
-- STEP 8: RENAME INDEXES - WEEKLY_REPORTS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_weekly_reports_uid RENAME TO idx_maintenance_weekly_reports_uid;
ALTER INDEX IF EXISTS idx_weekly_reports_status RENAME TO idx_maintenance_weekly_reports_status;
ALTER INDEX IF EXISTS idx_weekly_reports_date RENAME TO idx_maintenance_weekly_reports_date;
ALTER INDEX IF EXISTS idx_weekly_reports_year_week RENAME TO idx_maintenance_weekly_reports_year_week;

-- =============================================================================
-- STEP 9: RENAME INDEXES - QCONTACT_SYNC_LOG TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_qcontact_sync_ticket RENAME TO idx_maintenance_qcontact_sync_ticket;
ALTER INDEX IF EXISTS idx_qcontact_sync_direction RENAME TO idx_maintenance_qcontact_sync_direction;
ALTER INDEX IF EXISTS idx_qcontact_sync_status RENAME TO idx_maintenance_qcontact_sync_status;
ALTER INDEX IF EXISTS idx_qcontact_sync_timestamp RENAME TO idx_maintenance_qcontact_sync_timestamp;
ALTER INDEX IF EXISTS idx_qcontact_ticket_id RENAME TO idx_maintenance_qcontact_ticket_id;

-- =============================================================================
-- STEP 10: RENAME INDEXES - GUARANTEE_PERIODS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_guarantee_periods_project RENAME TO idx_maintenance_guarantee_periods_project;

-- =============================================================================
-- STEP 11: RENAME INDEXES - WHATSAPP_NOTIFICATIONS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_whatsapp_ticket RENAME TO idx_maintenance_whatsapp_ticket;
ALTER INDEX IF EXISTS idx_whatsapp_recipient_type RENAME TO idx_maintenance_whatsapp_recipient_type;
ALTER INDEX IF EXISTS idx_whatsapp_status RENAME TO idx_maintenance_whatsapp_status;
ALTER INDEX IF EXISTS idx_whatsapp_created_at RENAME TO idx_maintenance_whatsapp_created_at;
ALTER INDEX IF EXISTS idx_whatsapp_phone RENAME TO idx_maintenance_whatsapp_phone;

-- =============================================================================
-- STEP 12: RENAME INDEXES - TICKET_ATTACHMENTS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_attachments_ticket RENAME TO idx_maintenance_attachments_ticket;
ALTER INDEX IF EXISTS idx_attachments_verification_step RENAME TO idx_maintenance_attachments_verification_step;
ALTER INDEX IF EXISTS idx_attachments_file_type RENAME TO idx_maintenance_attachments_file_type;
ALTER INDEX IF EXISTS idx_attachments_is_evidence RENAME TO idx_maintenance_attachments_is_evidence;
ALTER INDEX IF EXISTS idx_attachments_uploaded_at RENAME TO idx_maintenance_attachments_uploaded_at;

-- =============================================================================
-- STEP 13: RENAME INDEXES - TICKET_NOTES TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_notes_ticket RENAME TO idx_maintenance_notes_ticket;
ALTER INDEX IF EXISTS idx_notes_type RENAME TO idx_maintenance_notes_type;
ALTER INDEX IF EXISTS idx_notes_created_at RENAME TO idx_maintenance_notes_created_at;
ALTER INDEX IF EXISTS idx_notes_system_event RENAME TO idx_maintenance_notes_system_event;

-- =============================================================================
-- STEP 14: RENAME INDEXES - QA_READINESS_CHECKS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_qa_readiness_ticket RENAME TO idx_maintenance_qa_checks_ticket;
ALTER INDEX IF EXISTS idx_qa_readiness_passed RENAME TO idx_maintenance_qa_checks_passed;
ALTER INDEX IF EXISTS idx_qa_readiness_checked_at RENAME TO idx_maintenance_qa_checks_checked_at;

-- =============================================================================
-- STEP 15: RENAME INDEXES - QA_RISK_ACCEPTANCES TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_risk_acceptance_ticket RENAME TO idx_maintenance_risk_acceptances_ticket;
ALTER INDEX IF EXISTS idx_risk_acceptance_status RENAME TO idx_maintenance_risk_acceptances_status;
ALTER INDEX IF EXISTS idx_risk_acceptance_expiry RENAME TO idx_maintenance_risk_acceptances_expiry;
ALTER INDEX IF EXISTS idx_risk_acceptance_type RENAME TO idx_maintenance_risk_acceptances_type;
ALTER INDEX IF EXISTS idx_risk_acceptance_followup RENAME TO idx_maintenance_risk_acceptances_followup;

-- =============================================================================
-- STEP 16: RENAME INDEXES - HANDOVER_SNAPSHOTS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_handover_ticket RENAME TO idx_maintenance_handover_ticket;
ALTER INDEX IF EXISTS idx_handover_type RENAME TO idx_maintenance_handover_type;
ALTER INDEX IF EXISTS idx_handover_timestamp RENAME TO idx_maintenance_handover_timestamp;
ALTER INDEX IF EXISTS idx_handover_from_owner RENAME TO idx_maintenance_handover_from_owner;
ALTER INDEX IF EXISTS idx_handover_to_owner RENAME TO idx_maintenance_handover_to_owner;

-- =============================================================================
-- STEP 17: RENAME INDEXES - REPEAT_FAULT_ESCALATIONS TABLE
-- =============================================================================

ALTER INDEX IF EXISTS idx_escalation_scope RENAME TO idx_maintenance_escalation_scope;
ALTER INDEX IF EXISTS idx_escalation_status RENAME TO idx_maintenance_escalation_status;
ALTER INDEX IF EXISTS idx_escalation_project RENAME TO idx_maintenance_escalation_project;
ALTER INDEX IF EXISTS idx_escalation_ticket RENAME TO idx_maintenance_escalation_ticket;
ALTER INDEX IF EXISTS idx_escalation_created_at RENAME TO idx_maintenance_escalation_created_at;
ALTER INDEX IF EXISTS idx_escalation_type RENAME TO idx_maintenance_escalation_type;

-- =============================================================================
-- STEP 18: RENAME FOREIGN KEY CONSTRAINTS (if they exist)
-- Note: Using DO blocks to handle missing constraints gracefully
-- =============================================================================

-- FK constraints on maintenance_tickets
DO $$ BEGIN ALTER TABLE maintenance_tickets RENAME CONSTRAINT fk_tickets_created_by TO fk_maintenance_tickets_created_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_tickets RENAME CONSTRAINT fk_tickets_closed_by TO fk_maintenance_tickets_closed_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_tickets RENAME CONSTRAINT fk_tickets_assigned_to TO fk_maintenance_tickets_assigned_to; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_verification_steps
DO $$ BEGIN ALTER TABLE maintenance_verification_steps RENAME CONSTRAINT fk_verification_steps_ticket TO fk_maintenance_verification_steps_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_verification_steps RENAME CONSTRAINT fk_verification_steps_completed_by TO fk_maintenance_verification_steps_completed_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_weekly_reports
DO $$ BEGIN ALTER TABLE maintenance_weekly_reports RENAME CONSTRAINT fk_weekly_reports_imported_by TO fk_maintenance_weekly_reports_imported_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_qcontact_sync_log
DO $$ BEGIN ALTER TABLE maintenance_qcontact_sync_log RENAME CONSTRAINT fk_qcontact_sync_log_ticket TO fk_maintenance_qcontact_sync_log_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_whatsapp_notifications (table may not exist)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'maintenance_whatsapp_notifications') THEN
    ALTER TABLE maintenance_whatsapp_notifications RENAME CONSTRAINT fk_whatsapp_notifications_ticket TO fk_maintenance_whatsapp_notifications_ticket;
  END IF;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_attachments
DO $$ BEGIN ALTER TABLE maintenance_attachments RENAME CONSTRAINT fk_ticket_attachments_ticket TO fk_maintenance_attachments_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_attachments RENAME CONSTRAINT fk_ticket_attachments_verification_step TO fk_maintenance_attachments_verification_step; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_attachments RENAME CONSTRAINT fk_ticket_attachments_uploaded_by TO fk_maintenance_attachments_uploaded_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_notes
DO $$ BEGIN ALTER TABLE maintenance_notes RENAME CONSTRAINT fk_ticket_notes_ticket TO fk_maintenance_notes_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_notes RENAME CONSTRAINT fk_ticket_notes_created_by TO fk_maintenance_notes_created_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_qa_checks
DO $$ BEGIN ALTER TABLE maintenance_qa_checks RENAME CONSTRAINT fk_qa_readiness_checks_ticket TO fk_maintenance_qa_checks_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_qa_checks RENAME CONSTRAINT fk_qa_readiness_checks_checked_by TO fk_maintenance_qa_checks_checked_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_risk_acceptances
DO $$ BEGIN ALTER TABLE maintenance_risk_acceptances RENAME CONSTRAINT fk_qa_risk_acceptances_ticket TO fk_maintenance_risk_acceptances_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_risk_acceptances RENAME CONSTRAINT fk_qa_risk_acceptances_accepted_by TO fk_maintenance_risk_acceptances_accepted_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_risk_acceptances RENAME CONSTRAINT fk_qa_risk_acceptances_resolved_by TO fk_maintenance_risk_acceptances_resolved_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_handover_snapshots
DO $$ BEGIN ALTER TABLE maintenance_handover_snapshots RENAME CONSTRAINT fk_handover_snapshots_ticket TO fk_maintenance_handover_snapshots_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_handover_snapshots RENAME CONSTRAINT fk_handover_snapshots_handover_by TO fk_maintenance_handover_snapshots_handover_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- FK constraints on maintenance_escalations
DO $$ BEGIN ALTER TABLE maintenance_escalations RENAME CONSTRAINT fk_repeat_fault_escalations_ticket TO fk_maintenance_escalations_ticket; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE maintenance_escalations RENAME CONSTRAINT fk_repeat_fault_escalations_resolved_by TO fk_maintenance_escalations_resolved_by; EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

-- =============================================================================
-- STEP 19: UPDATE TABLE COMMENTS (for tables that exist)
-- =============================================================================

DO $$ BEGIN COMMENT ON TABLE maintenance_tickets IS 'Core maintenance ticket table for managing fiber network issues, faults, and maintenance requests'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_attachments IS 'File attachments and evidence photos for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_notes IS 'Internal and client notes for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_verification_steps IS '12-step verification checklist for maintenance ticket completion and QA approval'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_weekly_reports IS 'Weekly report import batch tracking for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_qcontact_sync_log IS 'QContact bidirectional sync audit log for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_guarantee_periods IS 'Project-specific guarantee period configuration for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_whatsapp_notifications IS 'WhatsApp notification delivery tracking for maintenance tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_qa_checks IS 'Pre-QA validation checks to ensure maintenance tickets are ready for QA review'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_risk_acceptances IS 'QA risk acceptances for conditional approvals with documented exceptions'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_handover_snapshots IS 'Immutable snapshots of maintenance ticket state at handover points (Build -> QA -> Ops)'; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN COMMENT ON TABLE maintenance_escalations IS 'Tracks repeat fault patterns and escalations to infrastructure-level tickets'; EXCEPTION WHEN undefined_table THEN NULL; END $$;

COMMIT;
