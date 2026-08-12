-- 490: give Wiekus Moolman edit on the H&S module.
--
-- He asked on 2026-08-11 for the PPE issue screen to accept the signed
-- acknowledgement form he uses on site. That shipped (migration 489), but he
-- cannot use it: his role is `viewer`, which grants
-- projects.health-safety view=true / edit=false, and `withHsPermission` maps
-- every non-GET to 'edit'. He can see the PPE register and the acknowledgement
-- panel, and 403s on "Start a sheet" and on the upload itself.
--
-- A named user override rather than a role change: `viewer` is a company-wide
-- role and widening it would hand H&S edit to every current and future viewer.
-- Changing his role to `manager` would grant him far more than the one module
-- he asked about. This is the narrowest change that makes the feature work,
-- and it mirrors the existing grants for Warwick and Louise on the same key.
--
-- NOT inert: `userHasPermission` checks ancestors for 'view' ONLY
-- (src/lib/permissions/index.ts) and his `viewer` role already grants
-- `projects` view=true, so the parent does not block this leaf. That check
-- matters — a leaf grant under a blocked ancestor is silently dead, which is
-- what happened to Warwick's training-certificate grant in July.
--
-- delete stays FALSE. Removing a wrongly-uploaded sheet goes through
-- DELETE /api/health-safety/attachments/[id], which withHsPermission maps to
-- 'edit' — so he can still correct his own mistakes without holding a delete
-- right over H&S records generally.
--
-- Rerunnable.

BEGIN;

INSERT INTO user_permission_overrides
  (user_id, permission_key, override_type, actions, reason)
SELECT
  u.id,
  'projects.health-safety',
  'grant',
  '{"view": true, "edit": true, "create": true, "delete": false}'::jsonb,
  'H&S module edit for PPE acknowledgement sheets — he holds the signed paper on site. Authorised by Hein 2026-08-12.'
FROM users u
WHERE u.email = 'wiekus@velocityfibre.co.za'
ON CONFLICT (user_id, permission_key) DO NOTHING;

COMMIT;
