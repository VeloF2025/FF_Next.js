-- 485: narrow who may decide an overnight parking request.
--
-- Before this, `fleet.parking-requests` was granted to the manager, admin and
-- super_admin ROLES — 30 active users. Thirty approvers with no routing is not
-- oversight: everybody assumes somebody else will action the queue, and a
-- decision that carries disciplinary consequence for a named driver has no
-- accountable owner.
--
-- After this, exactly two people can decide: the fleet manager (Lizelle) and
-- one backup (Hein). Both are granted individually through
-- user_permission_overrides, which take priority over role in
-- isPermissionBlocked (src/lib/permissions/index.ts).
--
-- BREAK-GLASS, deliberately left open: any super_admin can grant themselves
-- this permission through the existing RBAC admin UI by adding their own
-- override row. That is the escape hatch if both approvers are unavailable —
-- it needs no code change and it leaves an audit row naming who did it, which
-- a role-level grant never did.
--
-- Rerunnable.

BEGIN;

-- Roles keep the row but lose every action, rather than deleting the row:
-- isPermissionBlocked treats a MISSING role row and an all-false row the same
-- ("no permission entry = blocked"), and keeping it makes the intent legible in
-- the admin UI instead of looking like an oversight.
UPDATE role_permissions
   SET actions = '{"view": false, "edit": false, "create": false, "delete": false}'::jsonb
 WHERE permission_key = 'fleet.parking-requests'
   AND role IN ('manager', 'admin', 'super_admin');

-- The two named approvers. Looked up by email rather than hardcoded UUID so
-- this reads correctly and fails loudly if the account is gone.
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, reason)
SELECT u.id,
       'fleet.parking-requests',
       'grant',
       '{"view": true, "edit": true, "create": false, "delete": false}'::jsonb,
       'Named parking approver — migration 485 narrowed this from 30 role-holders to 2'
  FROM users u
 WHERE u.email IN ('lizelle@velocityfibre.co.za', 'hein@velocityfibre.co.za')
ON CONFLICT (user_id, permission_key) DO UPDATE
   SET override_type = EXCLUDED.override_type,
       actions       = EXCLUDED.actions,
       reason        = EXCLUDED.reason,
       expires_at    = NULL;

-- Fail loudly rather than silently leaving nobody able to approve: if the
-- emails ever change, a migration that quietly grants zero people would hand us
-- an unusable queue and no error.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM user_permission_overrides
   WHERE permission_key = 'fleet.parking-requests'
     AND override_type = 'grant'
     AND actions->>'edit' = 'true';
  IF n < 2 THEN
    RAISE EXCEPTION 'migration 485 granted % approver(s), expected 2 — check the emails', n;
  END IF;
END $$;

COMMIT;
