-- Rollback: WA mention -> ticket / DR-lifecycle linking
-- Pre-rollback operational step: pg_dump maintenance_notes and
-- maintenance_wa_photos in case rows were written under the new columns.

BEGIN;

DROP INDEX IF EXISTS uq_dr_activity_log_wa_mention;
DROP INDEX IF EXISTS uq_maintenance_activities_wa_mention;
DROP INDEX IF EXISTS idx_maintenance_wa_photos_ticket;
DROP INDEX IF EXISTS uq_maintenance_notes_wa_message;

ALTER TABLE maintenance_wa_photos DROP COLUMN IF EXISTS ticket_id;
ALTER TABLE maintenance_notes DROP COLUMN IF EXISTS wa_message_id;

-- Restore the pre-migration note_type CHECK.
ALTER TABLE maintenance_notes DROP CONSTRAINT IF EXISTS maintenance_notes_note_type_check;
ALTER TABLE maintenance_notes ADD CONSTRAINT maintenance_notes_note_type_check CHECK (
  note_type IN ('internal', 'external', 'system')
);

COMMIT;
