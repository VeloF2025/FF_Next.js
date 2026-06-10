-- Migration 407: align storeman asset check-in permission with check-out
-- Purpose: the asset check-out/check-in APIs (app/api/assets/[id]/checkout and
--          /checkin) are being hardened to enforce RBAC at the API layer
--          (previously requireAuth-only — any authenticated user could check
--          out/in any asset). The existing seed grants storeman create/edit on
--          assets.checkout but ALL-FALSE on assets.checkin, which would leave
--          storemen able to hand out assets but unable to receive returns — an
--          operational contradiction, since storemen are exactly who process
--          returns. This was a seeding oversight; align checkin with checkout.
-- Scope: storeman role only. technician/viewer stay view-only, contractor stays
--        denied, deliberately matching their checkout grants.
-- Fully idempotent — upsert so a fresh DB where the (storeman, assets.checkin)
-- seed row does not yet exist gets the grant created rather than silently
-- no-op'd into a denied state. role_id is nullable; the unique constraint is
-- role_permissions_role_permission_key_key (role, permission_key).

INSERT INTO role_permissions (role, permission_key, actions)
VALUES ('storeman', 'assets.checkin',
        '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key)
DO UPDATE SET actions = EXCLUDED.actions,
              updated_at = NOW();
