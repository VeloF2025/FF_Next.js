-- Rollback 495.
--
-- Removes the two `system` rows added for read access. Only run alongside reverting the
-- permission check on pages/api/manco-action-items/* — on its own it restores the 403 on
-- GET for the service account that 495 exists to prevent.

DELETE FROM role_permissions
 WHERE role = 'system'
   AND permission_key IN ('dashboard', 'dashboard.action-items');
