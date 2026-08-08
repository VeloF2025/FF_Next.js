-- Rollback 485: restore the role-level grants and drop the named overrides.
-- Rerunnable.
BEGIN;

UPDATE role_permissions
   SET actions = '{"view": true, "edit": true, "create": true, "delete": true}'::jsonb
 WHERE permission_key = 'fleet.parking-requests'
   AND role IN ('admin', 'super_admin');

-- manager never had delete; restore its original shape exactly.
UPDATE role_permissions
   SET actions = '{"view": true, "edit": true, "create": true, "delete": false}'::jsonb
 WHERE permission_key = 'fleet.parking-requests'
   AND role = 'manager';

DELETE FROM user_permission_overrides
 WHERE permission_key = 'fleet.parking-requests'
   AND reason LIKE 'Named parking approver%';

COMMIT;
