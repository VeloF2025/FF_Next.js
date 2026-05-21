-- Migration 364: Consolidate NOC ticket statuses 'closed' → 'resolved'
--
-- Context: The Kanban board hid the 'closed' column by default
-- (DEFAULT_EXCLUDED_STATUSES in KanbanBoard.tsx), so any ticket moved to
-- 'closed' effectively disappeared. 'resolved' and 'closed' were redundant
-- terminal states. Going forward, 'resolved' is the single terminal state
-- for completed work. The QContact integration still exchanges 'closed'
-- externally; mapping happens at the sync boundary.
--
-- Pre-check (2026-05-21): 1595 rows with status='closed', 1272 with
-- status='resolved' — post-migration the resolved bucket will hold ~2867.
-- No CHECK constraint exists on maintenance_tickets.status, so no schema
-- change is required.
--
-- Idempotent: safe to re-run (no-op once the closed→resolved rewrite is done).

BEGIN;

-- Audit trail: how many rows are about to flip
DO $$
DECLARE
  closed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO closed_count
  FROM maintenance_tickets
  WHERE status = 'closed';
  RAISE NOTICE 'Migration 364: rewriting % maintenance_tickets rows from closed to resolved', closed_count;
END $$;

UPDATE maintenance_tickets
   SET status = 'resolved',
       status_changed_at = COALESCE(status_changed_at, NOW()),
       updated_at = NOW()
 WHERE status = 'closed';

COMMIT;
