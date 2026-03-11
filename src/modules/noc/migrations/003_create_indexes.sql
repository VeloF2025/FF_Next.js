-- Ticketing Module - Indexes Migration
-- Creates indexes for all ticketing tables to optimize query performance
--
-- Depends on:
--   - 001_create_core_tables.sql
--   - 002_create_maintenance_tables.sql

-- =============================================================================
-- TICKETS TABLE INDEXES
-- =============================================================================

-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_uid ON tickets(ticket_uid);
CREATE INDEX IF NOT EXISTS idx_tickets_dr ON tickets(dr_number);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_type ON tickets(ticket_type);

-- Assignment and project indexes
CREATE INDEX IF NOT EXISTS idx_tickets_project ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_contractor ON tickets(assigned_contractor_id);

-- Location indexes for repeat fault detection
CREATE INDEX IF NOT EXISTS idx_tickets_pole ON tickets(pole_number);
CREATE INDEX IF NOT EXISTS idx_tickets_pon ON tickets(pon_number);
CREATE INDEX IF NOT EXISTS idx_tickets_zone ON tickets(zone_id);

-- SLA and time-based indexes
CREATE INDEX IF NOT EXISTS idx_tickets_sla ON tickets(sla_due_at) WHERE NOT sla_breached;
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(closed_at) WHERE closed_at IS NOT NULL;

-- QA readiness index
CREATE INDEX IF NOT EXISTS idx_tickets_qa_ready ON tickets(qa_ready);

-- Fault cause index for trend analysis
CREATE INDEX IF NOT EXISTS idx_tickets_fault_cause ON tickets(fault_cause) WHERE fault_cause IS NOT NULL;

-- Source tracking index
CREATE INDEX IF NOT EXISTS idx_tickets_source ON tickets(source);
CREATE INDEX IF NOT EXISTS idx_tickets_external_id ON tickets(external_id) WHERE external_id IS NOT NULL;

-- Guarantee status index
CREATE INDEX IF NOT EXISTS idx_tickets_guarantee_status ON tickets(guarantee_status);

-- Composite index for common queries (status + priority + assigned_to)
CREATE INDEX IF NOT EXISTS idx_tickets_status_priority_assigned ON tickets(status, priority, assigned_to);

-- Composite index for location-based queries
CREATE INDEX IF NOT EXISTS idx_tickets_project_status ON tickets(project_id, status);

COMMENT ON INDEX idx_tickets_dr IS 'Optimize DR number lookups';
COMMENT ON INDEX idx_tickets_sla IS 'Optimize SLA breach detection queries (excludes already breached)';
COMMENT ON INDEX idx_tickets_pole IS 'Optimize repeat fault detection by pole number';
COMMENT ON INDEX idx_tickets_pon IS 'Optimize repeat fault detection by PON number';
COMMENT ON INDEX idx_tickets_zone IS 'Optimize repeat fault detection by zone';

-- =============================================================================
-- VERIFICATION_STEPS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_verification_ticket ON verification_steps(ticket_id);
CREATE INDEX IF NOT EXISTS idx_verification_step_number ON verification_steps(ticket_id, step_number);
CREATE INDEX IF NOT EXISTS idx_verification_complete ON verification_steps(is_complete);

COMMENT ON INDEX idx_verification_ticket IS 'Optimize queries for all steps of a ticket';
COMMENT ON INDEX idx_verification_step_number IS 'Optimize lookup of specific step for a ticket';

-- =============================================================================
-- WEEKLY_REPORTS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_weekly_reports_uid ON weekly_reports(report_uid);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_status ON weekly_reports(status);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_date ON weekly_reports(report_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_year_week ON weekly_reports(year, week_number);

COMMENT ON INDEX idx_weekly_reports_date IS 'Optimize chronological report listing';
COMMENT ON INDEX idx_weekly_reports_year_week IS 'Optimize lookup by year and week number';

-- =============================================================================
-- QCONTACT_SYNC_LOG TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_qcontact_sync_ticket ON qcontact_sync_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_qcontact_sync_direction ON qcontact_sync_log(sync_direction);
CREATE INDEX IF NOT EXISTS idx_qcontact_sync_status ON qcontact_sync_log(status);
CREATE INDEX IF NOT EXISTS idx_qcontact_sync_timestamp ON qcontact_sync_log(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_qcontact_ticket_id ON qcontact_sync_log(qcontact_ticket_id);

COMMENT ON INDEX idx_qcontact_sync_ticket IS 'Optimize sync history for specific tickets';
COMMENT ON INDEX idx_qcontact_sync_timestamp IS 'Optimize chronological sync log queries';

-- =============================================================================
-- GUARANTEE_PERIODS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_guarantee_periods_project ON guarantee_periods(project_id);

COMMENT ON INDEX idx_guarantee_periods_project IS 'Optimize guarantee period lookup by project';

-- =============================================================================
-- WHATSAPP_NOTIFICATIONS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_ticket ON whatsapp_notifications(ticket_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_recipient_type ON whatsapp_notifications(recipient_type);
CREATE INDEX IF NOT EXISTS idx_whatsapp_status ON whatsapp_notifications(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_created_at ON whatsapp_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_phone ON whatsapp_notifications(recipient_phone);

COMMENT ON INDEX idx_whatsapp_ticket IS 'Optimize notification history for tickets';
COMMENT ON INDEX idx_whatsapp_status IS 'Optimize queries for pending/failed notifications';

-- =============================================================================
-- TICKET_ATTACHMENTS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_attachments_verification_step ON ticket_attachments(verification_step_id) WHERE verification_step_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_file_type ON ticket_attachments(file_type);
CREATE INDEX IF NOT EXISTS idx_attachments_is_evidence ON ticket_attachments(is_evidence) WHERE is_evidence = true;
CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_at ON ticket_attachments(uploaded_at DESC);

COMMENT ON INDEX idx_attachments_ticket IS 'Optimize attachment retrieval for tickets';
COMMENT ON INDEX idx_attachments_verification_step IS 'Optimize photo evidence lookup by verification step';
COMMENT ON INDEX idx_attachments_is_evidence IS 'Optimize queries for evidence photos only';

-- =============================================================================
-- TICKET_NOTES TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notes_type ON ticket_notes(note_type);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON ticket_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_system_event ON ticket_notes(system_event) WHERE system_event IS NOT NULL;

COMMENT ON INDEX idx_notes_ticket IS 'Optimize note retrieval for tickets';
COMMENT ON INDEX idx_notes_system_event IS 'Optimize queries for system-generated notes';

-- =============================================================================
-- QA_READINESS_CHECKS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_qa_readiness_ticket ON qa_readiness_checks(ticket_id);
CREATE INDEX IF NOT EXISTS idx_qa_readiness_passed ON qa_readiness_checks(passed);
CREATE INDEX IF NOT EXISTS idx_qa_readiness_checked_at ON qa_readiness_checks(checked_at DESC);

COMMENT ON INDEX idx_qa_readiness_ticket IS 'Optimize readiness check history for tickets';
COMMENT ON INDEX idx_qa_readiness_checked_at IS 'Optimize chronological readiness check queries';

-- =============================================================================
-- QA_RISK_ACCEPTANCES TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_risk_acceptance_ticket ON qa_risk_acceptances(ticket_id);
CREATE INDEX IF NOT EXISTS idx_risk_acceptance_status ON qa_risk_acceptances(status);
CREATE INDEX IF NOT EXISTS idx_risk_acceptance_expiry ON qa_risk_acceptances(risk_expiry_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_risk_acceptance_type ON qa_risk_acceptances(risk_type);
CREATE INDEX IF NOT EXISTS idx_risk_acceptance_followup ON qa_risk_acceptances(followup_date) WHERE requires_followup = true;

COMMENT ON INDEX idx_risk_acceptance_ticket IS 'Optimize risk acceptance retrieval for tickets';
COMMENT ON INDEX idx_risk_acceptance_expiry IS 'Optimize queries for expiring risks (active only)';
COMMENT ON INDEX idx_risk_acceptance_followup IS 'Optimize queries for risks requiring follow-up';

-- =============================================================================
-- HANDOVER_SNAPSHOTS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_handover_ticket ON handover_snapshots(ticket_id);
CREATE INDEX IF NOT EXISTS idx_handover_type ON handover_snapshots(handover_type);
CREATE INDEX IF NOT EXISTS idx_handover_timestamp ON handover_snapshots(handover_at DESC);
CREATE INDEX IF NOT EXISTS idx_handover_from_owner ON handover_snapshots(from_owner_type, from_owner_id);
CREATE INDEX IF NOT EXISTS idx_handover_to_owner ON handover_snapshots(to_owner_type, to_owner_id);

COMMENT ON INDEX idx_handover_ticket IS 'Optimize handover history retrieval for tickets';
COMMENT ON INDEX idx_handover_timestamp IS 'Optimize chronological handover queries';
COMMENT ON INDEX idx_handover_from_owner IS 'Optimize queries by handover source (e.g., all from QA)';
COMMENT ON INDEX idx_handover_to_owner IS 'Optimize queries by handover destination (e.g., all to Maintenance)';

-- =============================================================================
-- REPEAT_FAULT_ESCALATIONS TABLE INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_escalation_scope ON repeat_fault_escalations(scope_type, scope_value);
CREATE INDEX IF NOT EXISTS idx_escalation_status ON repeat_fault_escalations(status);
CREATE INDEX IF NOT EXISTS idx_escalation_project ON repeat_fault_escalations(project_id);
CREATE INDEX IF NOT EXISTS idx_escalation_ticket ON repeat_fault_escalations(escalation_ticket_id);
CREATE INDEX IF NOT EXISTS idx_escalation_created_at ON repeat_fault_escalations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalation_type ON repeat_fault_escalations(escalation_type);

COMMENT ON INDEX idx_escalation_scope IS 'Optimize escalation lookup by scope (pole, PON, zone, DR) and value';
COMMENT ON INDEX idx_escalation_status IS 'Optimize queries for active escalations';
COMMENT ON INDEX idx_escalation_ticket IS 'Optimize lookup of escalation by infrastructure ticket ID';

-- =============================================================================
-- FOREIGN KEY CONSTRAINTS
-- =============================================================================
-- Note: Foreign keys are added separately for clarity and to ensure dependent tables exist

-- tickets table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_created_by') THEN
        ALTER TABLE tickets ADD CONSTRAINT fk_tickets_created_by
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_closed_by') THEN
        ALTER TABLE tickets ADD CONSTRAINT fk_tickets_closed_by
            FOREIGN KEY (closed_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_assigned_to') THEN
        ALTER TABLE tickets ADD CONSTRAINT fk_tickets_assigned_to
            FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- verification_steps table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_verification_steps_ticket') THEN
        ALTER TABLE verification_steps ADD CONSTRAINT fk_verification_steps_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_verification_steps_completed_by') THEN
        ALTER TABLE verification_steps ADD CONSTRAINT fk_verification_steps_completed_by
            FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- weekly_reports table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_weekly_reports_imported_by') THEN
        ALTER TABLE weekly_reports ADD CONSTRAINT fk_weekly_reports_imported_by
            FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- qcontact_sync_log table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qcontact_sync_log_ticket') THEN
        ALTER TABLE qcontact_sync_log ADD CONSTRAINT fk_qcontact_sync_log_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    END IF;
END $$;

-- whatsapp_notifications table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_whatsapp_notifications_ticket') THEN
        ALTER TABLE whatsapp_notifications ADD CONSTRAINT fk_whatsapp_notifications_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ticket_attachments table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_attachments_ticket') THEN
        ALTER TABLE ticket_attachments ADD CONSTRAINT fk_ticket_attachments_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_attachments_verification_step') THEN
        ALTER TABLE ticket_attachments ADD CONSTRAINT fk_ticket_attachments_verification_step
            FOREIGN KEY (verification_step_id) REFERENCES verification_steps(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_attachments_uploaded_by') THEN
        ALTER TABLE ticket_attachments ADD CONSTRAINT fk_ticket_attachments_uploaded_by
            FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ticket_notes table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_notes_ticket') THEN
        ALTER TABLE ticket_notes ADD CONSTRAINT fk_ticket_notes_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ticket_notes_created_by') THEN
        ALTER TABLE ticket_notes ADD CONSTRAINT fk_ticket_notes_created_by
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- qa_readiness_checks table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qa_readiness_checks_ticket') THEN
        ALTER TABLE qa_readiness_checks ADD CONSTRAINT fk_qa_readiness_checks_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qa_readiness_checks_checked_by') THEN
        ALTER TABLE qa_readiness_checks ADD CONSTRAINT fk_qa_readiness_checks_checked_by
            FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- qa_risk_acceptances table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qa_risk_acceptances_ticket') THEN
        ALTER TABLE qa_risk_acceptances ADD CONSTRAINT fk_qa_risk_acceptances_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qa_risk_acceptances_accepted_by') THEN
        ALTER TABLE qa_risk_acceptances ADD CONSTRAINT fk_qa_risk_acceptances_accepted_by
            FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_qa_risk_acceptances_resolved_by') THEN
        ALTER TABLE qa_risk_acceptances ADD CONSTRAINT fk_qa_risk_acceptances_resolved_by
            FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- handover_snapshots table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_handover_snapshots_ticket') THEN
        ALTER TABLE handover_snapshots ADD CONSTRAINT fk_handover_snapshots_ticket
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_handover_snapshots_handover_by') THEN
        ALTER TABLE handover_snapshots ADD CONSTRAINT fk_handover_snapshots_handover_by
            FOREIGN KEY (handover_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- repeat_fault_escalations table foreign keys
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_repeat_fault_escalations_ticket') THEN
        ALTER TABLE repeat_fault_escalations ADD CONSTRAINT fk_repeat_fault_escalations_ticket
            FOREIGN KEY (escalation_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_repeat_fault_escalations_resolved_by') THEN
        ALTER TABLE repeat_fault_escalations ADD CONSTRAINT fk_repeat_fault_escalations_resolved_by
            FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;
