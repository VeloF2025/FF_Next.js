-- Rollback for migration 350: Remove Works QA snag RBAC entries.
-- Deletes role_permissions first (FK), then access_permissions.

BEGIN;

DELETE FROM role_permissions
WHERE permission_key IN (
  'construction-qa.works-qa.snags.create',
  'construction-qa.works-qa.snags.verify'
);

DELETE FROM access_permissions
WHERE key IN (
  'construction-qa.works-qa.snags.create',
  'construction-qa.works-qa.snags.verify'
);

COMMIT;
