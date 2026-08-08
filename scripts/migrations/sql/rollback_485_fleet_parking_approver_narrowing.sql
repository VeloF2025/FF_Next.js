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

-- Matched on the two emails as well as the reason: `reason` is free text an
-- admin can edit from the RBAC UI, so keying the delete on it alone would
-- either miss a renamed row or delete a genuine unrelated grant someone added
-- by hand.
DELETE FROM user_permission_overrides o
 USING users u
 WHERE u.id = o.user_id
   AND o.permission_key = 'fleet.parking-requests'
   AND o.reason LIKE 'Named parking approver%'
   AND u.email IN ('lizelle@velocityfibre.co.za', 'hein@velocityfibre.co.za');

COMMIT;
