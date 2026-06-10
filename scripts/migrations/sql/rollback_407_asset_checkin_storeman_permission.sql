-- Rollback for migration 407: restore storeman assets.checkin to the original
-- all-false seed grant (view-only access via the page nav was never granted).

UPDATE role_permissions
SET actions = '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb,
    updated_at = NOW()
WHERE role = 'storeman'
  AND permission_key = 'assets.checkin';
