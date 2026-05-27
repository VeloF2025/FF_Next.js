-- =============================================================================
-- PP Ticket Auto-Resolve Backfill
-- =============================================================================
-- Context: oes_pp_data rows whose resolution_status is already 'activated'
-- but whose linked NOC ticket (maintenance_tickets) is still in an open state.
-- Going forward, triggerPpActivationCheck() flips these tickets automatically.
-- This migration retroactively closes the existing backlog.
--
-- Eligible: ticket.status IN ('open', 'assigned', 'in_progress')
-- Skipped:  pending_qa, qa_*, pending_handover, handed_to_ops, resolved,
--           verified, closed, cancelled  (manual workflow states left intact)
-- =============================================================================

BEGIN;

-- 1. Capture the set of tickets we're about to flip, so we can use the same
--    list for both the UPDATE and the activity log inserts.
CREATE TEMP TABLE pp_auto_resolve_targets AS
SELECT
  mt.id              AS ticket_id,
  mt.ticket_uid      AS ticket_uid,
  mt.status          AS previous_status,
  mt.dr_number       AS dr_number,
  pp.serial_number   AS serial_number,
  pp.resolved_drop_number AS resolved_drop_number,
  COALESCE((pp.resolved_details ->> 'activated_date')::date, pp.resolved_at::date) AS activation_date
FROM maintenance_tickets mt
JOIN oes_pp_data pp ON pp.maintenance_ticket_id = mt.id
WHERE pp.resolution_status = 'activated'
  AND mt.status IN ('open', 'assigned', 'in_progress');

-- 2. Flip ticket status.
UPDATE maintenance_tickets mt
SET status     = 'resolved',
    updated_at = NOW()
FROM pp_auto_resolve_targets t
WHERE mt.id = t.ticket_id;

-- 3. Append a status_change activity per ticket so the audit trail is complete.
INSERT INTO maintenance_activities (
  ticket_id, activity_type, description, field_changes,
  created_by_name, created_by_email, source
)
SELECT
  t.ticket_id,
  'status_change',
  'Auto-resolved (backfill): serial ' || t.serial_number ||
    ' activated on OES ' || COALESCE(t.activation_date::text, 'unknown date') ||
    COALESCE(', DR ' || t.resolved_drop_number, ''),
  jsonb_build_object('status', jsonb_build_object('from', t.previous_status, 'to', 'resolved')),
  'System',
  'system@fibreflow.app',
  'fibreflow'
FROM pp_auto_resolve_targets t;

-- 4. DR-level timeline events (best-effort — only for tickets bound to a DR).
INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor, created_at)
SELECT
  t.dr_number,
  'ticket_status_changed',
  jsonb_build_object(
    'ticketId',    t.ticket_id,
    'ticketUid',   t.ticket_uid,
    'fromStatus',  t.previous_status,
    'toStatus',    'resolved'
  ),
  'pp-auto-resolve-backfill',
  NOW()
FROM pp_auto_resolve_targets t
WHERE t.dr_number IS NOT NULL;

-- 5. Sanity report — surface the count so the migration runner logs it.
DO $$
DECLARE
  flipped_count INT;
BEGIN
  SELECT COUNT(*) INTO flipped_count FROM pp_auto_resolve_targets;
  RAISE NOTICE 'PP auto-resolve backfill: flipped % tickets to resolved', flipped_count;
END $$;

DROP TABLE pp_auto_resolve_targets;

COMMIT;
