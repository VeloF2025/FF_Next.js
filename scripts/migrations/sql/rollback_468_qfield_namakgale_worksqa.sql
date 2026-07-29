-- Rollback: 468_qfield_namakgale_worksqa.sql

BEGIN;

DELETE FROM qfield_project_links qpl
USING qfield_projects qp
WHERE qpl.qfield_project_id = qp.id
  AND qp.qfield_project_id = 'b32184d6-1776-4b89-8afd-2907dfca86d4'
  AND qpl.fibreflow_project_id = '183fe626-7bf7-4793-bdb9-1a1dc2e21aa6'::uuid;

-- Preserve the registry row if another link was added after this migration.
DELETE FROM qfield_projects qp
WHERE qp.qfield_project_id = 'b32184d6-1776-4b89-8afd-2907dfca86d4'
  AND NOT EXISTS (
    SELECT 1 FROM qfield_project_links qpl WHERE qpl.qfield_project_id = qp.id
  );

DELETE FROM schema_migrations
WHERE filename = '468_qfield_namakgale_worksqa.sql';

COMMIT;
