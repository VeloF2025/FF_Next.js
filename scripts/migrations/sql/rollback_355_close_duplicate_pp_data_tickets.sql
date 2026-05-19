-- Rollback 355: reopen tickets auto-closed by 355_close_duplicate_pp_data_tickets.sql.
--
-- The forward migration is identifiable via the system note it inserts. We
-- reopen any pp_data ticket that carries a 'migration 355' note and was
-- closed (still no engagement) and remove the note. We do NOT re-link
-- oes_pp_data.maintenance_ticket_id — preserving the post-migration link
-- is harmless because the dedup guard in pp-data-tickets.ts now prevents
-- re-creation regardless.

BEGIN;

-- Drop the unique index first; reopening tickets would otherwise fail
-- the constraint as duplicates come back into the open set.
DROP INDEX IF EXISTS uniq_open_pp_data_ticket_per_serial;

WITH marker AS (
  SELECT DISTINCT ticket_id
    FROM maintenance_notes
   WHERE note_type = 'system'
     AND content LIKE 'Auto-closed as duplicate of % (migration 355_close_duplicate_pp_data_tickets).'
)
UPDATE maintenance_tickets t
   SET status = 'open',
       closed_at = NULL,
       updated_at = NOW()
  FROM marker m
 WHERE t.id = m.ticket_id
   AND t.status = 'closed';

DELETE FROM maintenance_notes n
 USING (
   SELECT DISTINCT ticket_id
     FROM maintenance_notes
    WHERE note_type = 'system'
      AND content LIKE 'Auto-closed as duplicate of % (migration 355_close_duplicate_pp_data_tickets).'
 ) m
 WHERE n.ticket_id = m.ticket_id
   AND n.note_type = 'system'
   AND n.content LIKE 'Auto-closed as duplicate of % (migration 355_close_duplicate_pp_data_tickets).';

COMMIT;
