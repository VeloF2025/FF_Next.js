-- 305_action_centre_phase_1.sql
--
-- RFC: Unified Action Centre + DR Timeline (docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md)
-- Phase 1 — prerequisites for resolution tracking, NOC ticket bridging, and timeline queries.
--
-- Additive, idempotent. No data migration required.

BEGIN;

-- 1) Express "resolved" / "ticketed" / "disputing" on individual deduction rows
--    so the Billing and Non-Invoiceables systems share a notion of state.
ALTER TABLE ft_billing_deductions
  ADD COLUMN IF NOT EXISTS resolution_status  TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS ticket_id          UUID REFERENCES maintenance_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_reason    TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by        TEXT,
  ADD COLUMN IF NOT EXISTS dispute_opened_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_outcome    TEXT,
  ADD COLUMN IF NOT EXISTS dispute_reason     TEXT;

-- Enforce the allowed resolution_status values. Drop-and-re-add keeps this idempotent.
ALTER TABLE ft_billing_deductions DROP CONSTRAINT IF EXISTS ft_billing_deductions_resolution_status_check;
ALTER TABLE ft_billing_deductions ADD CONSTRAINT ft_billing_deductions_resolution_status_check
  CHECK (resolution_status IN (
    'open',
    'in_progress',
    'ticketed',
    'resolved',
    'disputed',
    'disputing',
    'acknowledged',
    'auto_closed'
  ));

-- Indexes for the Action Centre filters (WHERE resolution_status IN (...) AND dr_number / week_ending)
CREATE INDEX IF NOT EXISTS idx_ft_ded_dr_status
  ON ft_billing_deductions(dr_number, resolution_status, week_ending DESC);

CREATE INDEX IF NOT EXISTS idx_ft_ded_ticket
  ON ft_billing_deductions(ticket_id) WHERE ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ft_ded_status_week
  ON ft_billing_deductions(resolution_status, week_ending DESC);

-- 2) Timeline queries hit dr_activity_log heavily; these indexes make the
--    per-DR timeline render in one millisecond instead of scanning.
CREATE INDEX IF NOT EXISTS idx_dr_activity_dr_time
  ON dr_activity_log(drop_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dr_activity_type_time
  ON dr_activity_log(event_type, created_at DESC);

-- 3) oes_pp_data → maintenance_tickets link so PP auto-close rules can track
--    the ticket they're waiting on.
ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES maintenance_tickets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pp_ticket
  ON oes_pp_data(ticket_id) WHERE ticket_id IS NOT NULL;

COMMIT;
