-- Migration 254: Analytics Reports sub-page RBAC keys
-- Adds per-tab permission keys for the Analytics Reports sandbox
-- analytics.reports.financial — Financial tab (Income Statement, COS, Cashflow, etc.)
-- analytics.reports.operations — Operations tab (Activations, etc.)

-- Insert sub-page permission keys
INSERT INTO access_permissions (key, label, description, module, is_active)
VALUES
  (
    'analytics.reports.financial',
    'Analytics — Financial Reports',
    'Access to the Financial tab in the Analytics Reports sandbox (Income Statement, COS Breakdown, Cashflow, OPEX, etc.)',
    'analytics',
    true
  ),
  (
    'analytics.reports.operations',
    'Analytics — Operations Reports',
    'Access to the Operations tab in the Analytics Reports sandbox (Activations, etc.)',
    'analytics',
    true
  )
ON CONFLICT (key) DO NOTHING;

-- Grant both tabs to existing analytics.reports users (Hein, Lew, Hanro)
-- This ensures no regression — existing users keep full access
INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions, granted_by, reason)
SELECT
  upo.user_id,
  sub_key.key,
  'grant',
  '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
  upo.granted_by,
  'Auto-granted from analytics.reports on sub-page RBAC migration'
FROM user_permission_overrides upo
CROSS JOIN (
  VALUES ('analytics.reports.financial'), ('analytics.reports.operations')
) AS sub_key(key)
WHERE upo.permission_key = 'analytics.reports'
  AND upo.override_type = 'grant'
  AND (upo.actions->>'view')::boolean = true
ON CONFLICT (user_id, permission_key) DO NOTHING;
