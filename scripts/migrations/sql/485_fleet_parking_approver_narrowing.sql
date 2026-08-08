-- 485: narrow who may decide an overnight parking request.
--
-- Before this, `fleet.parking-requests` was granted to the manager, admin and
-- super_admin ROLES — 30 active role-holders, of whom 26 could actually reach
-- the page (4 carry a live grant override on the parent `fleet` key with
-- view:false, so the ancestor cascade already denied them). Twenty-six
-- approvers with no routing is not oversight: everybody assumes somebody else
-- will action the queue, and a decision that carries disciplinary consequence
-- for a named driver has no accountable owner.
--
-- After this, exactly two people can decide: the fleet manager (Lizelle) and
-- one backup (Hein). Both are granted individually through
-- user_permission_overrides, which take priority over role in
-- isPermissionBlocked (src/lib/permissions/index.ts).
--
-- BREAK-GLASS, deliberately left open: the RBAC admin UI
-- (pages/api/admin/permissions/*) is gated on withRole('admin'), which is
-- HIERARCHICAL — so all 6 active admins and all 10 active super_admins can add
-- an override row granting themselves this permission. That is the escape
-- hatch if both approvers are unavailable: it needs no code change and leaves
-- an audit row naming who did it, which a role-level grant never did. It is
-- deliberately wider than the approver list; the point of the narrowing is
-- that taking the power is a recorded act, not that it is impossible.
--
-- Note this migration alone does NOT narrow anything: withPermission() and
-- userHasPermission() both return early for role === 'super_admin' without
-- reading these tables. isApprover() in the decide route
-- (src/modules/fleet/parking/parkingApprovers.ts) is what gives the rows below
-- their effect. Reverting that check silently restores all 10 super_admins.
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
-- Counted by IDENTITY and joined to users, not as a bare total: a stray
-- pre-existing override on this key would otherwise let the threshold pass
-- while one of the two named accounts was missing or deactivated, which is the
-- one failure this check exists to catch.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM user_permission_overrides o
    JOIN users u ON u.id = o.user_id
   WHERE o.permission_key = 'fleet.parking-requests'
     AND o.override_type = 'grant'
     AND o.actions->>'edit' = 'true'
     AND (o.expires_at IS NULL OR o.expires_at > now())
     AND u.is_active = true
     AND u.email IN ('lizelle@velocityfibre.co.za', 'hein@velocityfibre.co.za');
  IF n < 2 THEN
    RAISE EXCEPTION
      'migration 485 granted % of the 2 named approver(s) — check both emails exist and are active', n;
  END IF;
END $$;

COMMIT;
