DROP INDEX IF EXISTS idx_pole_qa_photos_unassigned_suggestions;
ALTER TABLE pole_qa_photos DROP COLUMN IF EXISTS unassigned_suggestions;
DELETE FROM migrations WHERE version = '368';
