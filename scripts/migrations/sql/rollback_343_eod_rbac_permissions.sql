-- Rollback for migration 343: Remove EOD RBAC entries.
-- Deletes role_permissions first (FK), then access_permissions.

BEGIN;

DELETE FROM role_permissions
WHERE permission_key IN (
  'system.data-sync.eod',
  'system.data-sync.eod.upload',
  'system.data-sync.eod.reconciliation',
  'system.data-sync.eod.history'
);

DELETE FROM access_permissions
WHERE key IN (
  'system.data-sync.eod',
  'system.data-sync.eod.upload',
  'system.data-sync.eod.reconciliation',
  'system.data-sync.eod.history'
);

COMMIT;
