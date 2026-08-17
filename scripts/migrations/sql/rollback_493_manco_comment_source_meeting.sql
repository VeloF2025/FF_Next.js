-- Rollback 493.
--
-- Reverses the schema half only. The DELETE in 493 removed transcript excerpts that
-- had been readable organisation-wide; those rows are not restorable from here and
-- deliberately so — re-creating leaked content on a rollback would undo the point of
-- the migration. Restore them from a backup if they are genuinely wanted.
--
-- Dropping the column returns every remaining extracted comment to
-- indistinguishable-from-human, which is the ungated state. Only run this alongside
-- reverting the application code that reads the column.

DROP INDEX IF EXISTS idx_manco_comments_source_meeting;

ALTER TABLE manco_action_item_comments
  DROP COLUMN IF EXISTS source_meeting_id;
