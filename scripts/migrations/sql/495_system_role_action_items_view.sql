-- 495: keep the `system` service account's READ access to action items.
--
-- pages/api/manco-action-items/* previously ran on withAuth alone, so every authenticated
-- identity could read them. Adding the per-action permission check turns "authenticated"
-- into "holds dashboard.action-items", and isPermissionBlocked denies when no role row
-- exists — so a role with no row loses access silently rather than noisily.
--
-- The `system` role has ten permission rows, all under analytics and construction-qa, and
-- none under dashboard. It also holds a live MCP session (expiring 2026-11-01), and
-- /api/manco-action-items is not in the MCP denylist, so an agent on that credential can
-- reach these routes today and would start receiving 403 on GET.
--
-- That would be a READ regression introduced by a change whose entire purpose is to
-- narrow WRITES. Granting view — and only view — keeps the read path exactly as it was
-- while the write narrowing still applies: create, edit and delete stay false, and
-- src/lib/auth/middleware.ts blocks writes from an mcp-kind session before the handler
-- runs regardless.
--
-- Deliberately not granted to `storeman`, the only other role without write access here;
-- storeman is explicitly denied view on this key and has no active users.

INSERT INTO role_permissions (role, permission_key, actions)
VALUES (
  'system',
  'dashboard.action-items',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- The child grant is inert without the parent: userHasPermission walks ancestors and a
-- blocked parent denies the child. `dashboard` has no `system` row either.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES (
  'system',
  'dashboard',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
)
ON CONFLICT (role, permission_key) DO NOTHING;
