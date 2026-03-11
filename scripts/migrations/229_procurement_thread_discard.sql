-- Migration 229: Add discard/close columns to procurement_threads + RBAC permission
-- Allows admin users to cancel/close pipeline threads with a reason

-- 1. Add cancel metadata columns
ALTER TABLE procurement_threads
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- 2. Add RBAC permission for pipeline discard action
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES ('action', 'procurement.pipelines.discard', 'procurement.pipelines', 'Discard Pipeline', 'Cancel or close a procurement pipeline thread', NULL, 50, true)
ON CONFLICT (key) DO NOTHING;

-- 3. Grant the discard action to admin roles by default
-- super_admin already has 'all' permissions
-- Grant to admin and manager roles
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('admin', 'procurement.pipelines.discard', '{"view": true, "create": false, "edit": true, "delete": true}'::jsonb),
  ('manager', 'procurement.pipelines.discard', '{"view": true, "create": false, "edit": true, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
