-- Rollback for 353_snags_nullable_report_id.sql
-- Restores NOT NULL constraint. Will FAIL if any rows with report_id=NULL exist —
-- this is intentional: clean up verification snags first if rolling back:
--   DELETE FROM snags WHERE report_id IS NULL AND category = 'verification';

ALTER TABLE snags ALTER COLUMN report_id SET NOT NULL;
