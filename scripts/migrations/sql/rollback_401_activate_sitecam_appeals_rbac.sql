-- Rollback for migration 401: remove SiteCam Appeals RBAC entries.
-- Deletes role_permissions first (FK to access_permissions), then the
-- access_permissions row.

BEGIN;

DELETE FROM role_permissions
WHERE permission_key = 'activate.sitecam-appeals';

DELETE FROM access_permissions
WHERE key = 'activate.sitecam-appeals';

COMMIT;
