-- Rollback 432: remove Planning RBAC permissions and their role grants.
BEGIN;
DELETE FROM role_permissions   WHERE permission_key IN ('planning', 'planning.main');
DELETE FROM access_permissions WHERE key            IN ('planning.main', 'planning');
COMMIT;
