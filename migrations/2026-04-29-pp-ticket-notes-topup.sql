-- =============================================================================
-- PP Ticket Auto-Resolve — Notes Top-Up
-- =============================================================================
-- Companion to 2026-04-29-pp-ticket-auto-resolve-backfill.sql.
-- The original backfill wrote 861 status_change rows into maintenance_activities
-- (History tab) but missed maintenance_notes (Notes tab). This top-up replays
-- the same content into maintenance_notes so users see the resolution note in
-- the place they expect.
--
-- Idempotent: skips tickets that already have a system resolution note from
-- the backfill (matched on content prefix).
-- =============================================================================

BEGIN;

INSERT INTO maintenance_notes (ticket_id, content, note_type, visibility, is_resolution)
SELECT
  ma.ticket_id,
  -- Strip the "(backfill)" tag so the live note and the top-up note read the
  -- same way going forward — the activity row keeps the audit-friendly form.
  REPLACE(ma.description, 'Auto-resolved (backfill):', 'Auto-resolved:'),
  'system',
  'public',
  true
FROM maintenance_activities ma
WHERE ma.description LIKE 'Auto-resolved (backfill):%'
  AND NOT EXISTS (
    SELECT 1 FROM maintenance_notes mn
    WHERE mn.ticket_id = ma.ticket_id
      AND mn.is_resolution = true
      AND mn.note_type = 'system'
      AND mn.content LIKE 'Auto-resolved:%'
  );

DO $$
DECLARE
  inserted_count INT;
BEGIN
  SELECT COUNT(*) INTO inserted_count
  FROM maintenance_notes
  WHERE note_type = 'system'
    AND is_resolution = true
    AND content LIKE 'Auto-resolved:%'
    AND created_at >= NOW() - INTERVAL '5 minutes';
  RAISE NOTICE 'PP auto-resolve notes top-up: % notes inserted', inserted_count;
END $$;

COMMIT;
