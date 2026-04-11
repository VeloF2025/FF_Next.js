-- Migration: 300_offline_sync_automation.sql
-- Purpose: Add automated nightly sync columns to offline_devices and create
--          helper view for billing cross-reference dispute detection.
-- Date: 2026-04-11
-- Relates to: fibertime-offline-sync.ts nightly pull from SharePoint

-- =============================================================================
-- STEP 1: Add ticket + recovery tracking columns to offline_devices
-- =============================================================================

ALTER TABLE offline_devices
  ADD COLUMN IF NOT EXISTS offline_ticket_id UUID REFERENCES maintenance_tickets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offline_ticket_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovered_at DATE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS recovery_confirmed_by VARCHAR(20) DEFAULT NULL;
-- recovery_confirmed_by values: 'oes_sync' | 'manual'

-- =============================================================================
-- STEP 2: Indexes for new columns
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_offline_devices_ticket
  ON offline_devices(offline_ticket_id)
  WHERE offline_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offline_devices_recovered
  ON offline_devices(recovered_at)
  WHERE recovered_at IS NOT NULL;

-- =============================================================================
-- STEP 3: Billing cross-reference view
-- Joins offline_devices to ft_billing_deductions for Note 5 dispute detection.
-- A "dispute candidate" is a deduction where we have no confirmed offline record.
-- "recovered" means the ONT came back online before the billing week closed.
-- "dying_gasp" means a transient event that may not warrant a deduction.
-- =============================================================================

CREATE OR REPLACE VIEW v_offline_billing_crossref AS
SELECT
  d.id                               AS deduction_id,
  d.dr_number,
  d.deduction_note,
  d.billing_week_id,
  d.serial_number                    AS billed_serial,
  d.project,
  -- Latest offline record within 14 days before billing week
  od.id                              AS offline_record_id,
  od.report_date                     AS offline_report_date,
  od.last_down_reason                AS offline_reason,
  od.serial_number                   AS offline_serial,
  od.recovered_at,
  od.offline_ticket_id,
  od.offline_ticket_created_at,
  od.match_status,
  -- Computed dispute flag:
  --   dispute_candidate : note5 deduction but no matching offline record
  --   recovered         : offline record exists but ONT already recovered
  --   dying_gasp        : offline reason is 'Dying Gasp' (transient)
  --   none              : no dispute signal
  CASE
    WHEN d.deduction_note = 'note5' AND od.id IS NULL THEN 'dispute_candidate'
    WHEN d.deduction_note = 'note5' AND od.recovered_at IS NOT NULL THEN 'recovered'
    WHEN d.deduction_note = 'note5' AND od.last_down_reason = 'Dying Gasp' THEN 'dying_gasp'
    ELSE 'none'
  END                                AS dispute_flag
FROM ft_billing_deductions d
LEFT JOIN LATERAL (
  SELECT od2.id, od2.report_date, od2.last_down_reason, od2.serial_number,
         od2.recovered_at, od2.offline_ticket_id, od2.offline_ticket_created_at,
         od2.match_status
  FROM offline_devices od2
  WHERE od2.drop_number = d.dr_number
    AND od2.recovered_at IS NULL
  ORDER BY od2.report_date DESC
  LIMIT 1
) od ON true
WHERE d.deduction_note = 'note5';

COMMENT ON VIEW v_offline_billing_crossref IS
  'Joins Note 5 billing deductions to offline_devices for dispute detection. '
  'dispute_candidate = deducted with no offline evidence; recovered = ONT back online; '
  'dying_gasp = transient event.';

-- =============================================================================
-- STEP 4: Comments
-- =============================================================================

COMMENT ON COLUMN offline_devices.offline_ticket_id IS
  'FK to maintenance_tickets — NOC ticket auto-created by nightly offline sync';
COMMENT ON COLUMN offline_devices.offline_ticket_created_at IS
  'Timestamp when the offline NOC ticket was created by the nightly sync';
COMMENT ON COLUMN offline_devices.recovered_at IS
  'Date when OES showed Active after this offline record — set by oes_sync or manual';
COMMENT ON COLUMN offline_devices.recovery_confirmed_by IS
  'Who confirmed recovery: oes_sync (automated) or manual (human)';
