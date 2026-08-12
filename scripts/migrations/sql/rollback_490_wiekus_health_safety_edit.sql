-- Rollback 490: remove Wiekus's H&S edit grant.
--
-- Scoped by user AND permission_key AND override_type, so it cannot touch his
-- unrelated people.staff.training-certificates grants from July, and cannot
-- remove a 'revoke' row someone added later on the same key.
--
-- Deliberately NOT keyed on `reason`: that is free text an admin can edit from
-- the RBAC UI, so matching on it would miss a renamed row (the mistake
-- rollback_485 documents).
--
-- Rerunnable.

BEGIN;

DELETE FROM user_permission_overrides o
 USING users u
 WHERE u.id = o.user_id
   AND u.email = 'wiekus@velocityfibre.co.za'
   AND o.permission_key = 'projects.health-safety'
   AND o.override_type = 'grant';

COMMIT;
