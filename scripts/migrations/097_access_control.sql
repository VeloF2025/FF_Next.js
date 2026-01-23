-- =====================================================
-- Migration 097: Access Control System
-- Creates tables for granular RBAC with module/page/tab/action hierarchy
-- =====================================================

-- 1. access_permissions - Define all controllable items (modules, pages, tabs, actions)
CREATE TABLE IF NOT EXISTS access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('module', 'page', 'tab', 'action')),
    key VARCHAR(100) UNIQUE NOT NULL,  -- e.g., 'procurement', 'procurement.sourcing', 'procurement.sourcing.boq'
    parent_key VARCHAR(100),           -- Parent permission for hierarchy
    label VARCHAR(100) NOT NULL,       -- Display name
    description TEXT,
    route VARCHAR(200),                -- Associated route (for pages)
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. role_permissions - Default permissions per role
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,         -- 'super_admin', 'admin', 'manager', etc.
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL DEFAULT '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(role, permission_key)
);

-- 3. user_permission_overrides - Custom overrides per user
CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    override_type VARCHAR(10) NOT NULL CHECK (override_type IN ('grant', 'revoke')),
    actions JSONB NOT NULL,            -- Which actions to grant/revoke
    granted_by UUID,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,            -- Optional expiry
    reason TEXT,
    UNIQUE(user_id, permission_key)
);

-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_access_permissions_type ON access_permissions(type);
CREATE INDEX IF NOT EXISTS idx_access_permissions_parent ON access_permissions(parent_key);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_user_overrides_user ON user_permission_overrides(user_id);

-- =====================================================
-- SEED: Modules (top-level sections)
-- =====================================================
INSERT INTO access_permissions (type, key, label, description, sort_order) VALUES
    ('module', 'dashboard', 'Dashboard', 'Main dashboard and overview', 1),
    ('module', 'projects', 'Projects', 'Project management', 2),
    ('module', 'activate', 'Activations', 'DR photo review and QA', 3),
    ('module', 'field', 'Field Operations', 'Field work management', 4),
    ('module', 'maintenance', 'Maintenance', 'Maintenance and support', 5),
    ('module', 'people', 'People', 'Staff management', 6),
    ('module', 'clients', 'Clients', 'Client management', 7),
    ('module', 'contractors', 'Contractors', 'Contractor management', 8),
    ('module', 'procurement', 'Procurement', 'Procurement and inventory', 9),
    ('module', 'assets', 'Assets', 'Asset management', 10),
    ('module', 'fleet', 'Fleet', 'Fleet management', 11),
    ('module', 'communications', 'Communications', 'Communications hub', 12),
    ('module', 'analytics', 'Analytics', 'Reports and analytics', 13),
    ('module', 'system', 'System', 'System settings and admin', 14)
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEED: Pages (under modules)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    -- Dashboard pages
    ('page', 'dashboard.main', 'dashboard', 'Main Dashboard', '/dashboard', 1),
    ('page', 'dashboard.action-items', 'dashboard', 'Action Items', '/action-items', 2),
    ('page', 'dashboard.daily-progress', 'dashboard', 'Daily Progress', '/daily-progress', 3),
    ('page', 'dashboard.enhanced-kpis', 'dashboard', 'Enhanced KPIs', '/enhanced-kpis', 4),
    ('page', 'dashboard.kpi-dashboard', 'dashboard', 'KPI Dashboard', '/kpi-dashboard', 5),

    -- Project pages
    ('page', 'projects.list', 'projects', 'Projects List', '/projects', 1),
    ('page', 'projects.imports', 'projects', 'Imports', '/imports', 2),
    ('page', 'projects.pipeline', 'projects', 'Pipeline', '/pipeline', 3),
    ('page', 'projects.onemap', 'projects', 'OneMap', '/onemap', 4),
    ('page', 'projects.qfield', 'projects', 'QField', '/qfield', 5),

    -- Activate pages
    ('page', 'activate.main', 'activate', 'Activations Hub', '/activate', 1),
    ('page', 'activate.qa-centre', 'activate', 'QA Centre', '/activate/qa-centre', 2),
    ('page', 'activate.monitoring', 'activate', 'Monitoring', '/activate/monitoring', 3),
    ('page', 'activate.photo-review', 'activate', 'Photo Review', '/photo-review', 4),

    -- Field Operations pages
    ('page', 'field.main', 'field', 'Field Dashboard', '/field', 1),
    ('page', 'field.tasks', 'field', 'Tasks', '/tasks', 2),
    ('page', 'field.nokia-equipment', 'field', 'Nokia Equipment', '/nokia-equipment', 3),
    ('page', 'field.marketing', 'field', 'Marketing Activations', '/marketing-activations', 4),

    -- Maintenance pages
    ('page', 'maintenance.main', 'maintenance', 'Maintenance Hub', '/maintenance', 1),
    ('page', 'maintenance.tickets', 'maintenance', 'Tickets', '/maintenance/tickets', 2),
    ('page', 'maintenance.escalations', 'maintenance', 'Escalations', '/maintenance/escalations', 3),
    ('page', 'maintenance.teams', 'maintenance', 'Teams', '/maintenance/teams', 4),
    ('page', 'maintenance.handover', 'maintenance', 'Handover', '/maintenance/handover', 5),
    ('page', 'maintenance.risks', 'maintenance', 'Risks', '/maintenance/risks', 6),
    ('page', 'maintenance.data-sync', 'maintenance', 'Data Sync', '/maintenance/data-sync', 7),

    -- People pages
    ('page', 'people.staff', 'people', 'Staff', '/staff', 1),
    ('page', 'people.health-safety', 'people', 'Health & Safety', '/health-safety', 2),
    ('page', 'people.meetings', 'people', 'Meetings', '/meetings', 3),

    -- Clients pages
    ('page', 'clients.list', 'clients', 'Clients List', '/clients', 1),

    -- Contractors pages
    ('page', 'contractors.list', 'contractors', 'Contractors List', '/contractors', 1),
    ('page', 'contractors.rag-dashboard', 'contractors', 'RAG Dashboard', '/contractors/rag-dashboard', 2),

    -- Procurement pages
    ('page', 'procurement.main', 'procurement', 'Procurement Dashboard', '/procurement', 1),
    ('page', 'procurement.sourcing', 'procurement', 'Sourcing', '/procurement/sourcing', 2),
    ('page', 'procurement.purchasing', 'procurement', 'Purchasing', '/procurement/purchasing', 3),
    ('page', 'procurement.inventory', 'procurement', 'Inventory', '/procurement/inventory', 4),
    ('page', 'procurement.financial', 'procurement', 'Financial', '/procurement/financial', 5),
    ('page', 'procurement.approvals', 'procurement', 'Approvals', '/procurement/approvals', 6),

    -- Assets pages
    ('page', 'assets.list', 'assets', 'Assets List', '/assets/list', 1),
    ('page', 'assets.categories', 'assets', 'Categories', '/assets/categories', 2),
    ('page', 'assets.checkout', 'assets', 'Checkout', '/assets/checkout', 3),
    ('page', 'assets.maintenance', 'assets', 'Maintenance', '/assets/maintenance', 4),
    ('page', 'assets.calibration', 'assets', 'Calibration', '/assets/calibration', 5),

    -- Fleet pages
    ('page', 'fleet.main', 'fleet', 'Fleet Dashboard', '/fleet', 1),
    ('page', 'fleet.vehicles', 'fleet', 'Vehicles', '/fleet/vehicles', 2),
    ('page', 'fleet.drivers', 'fleet', 'Drivers', '/fleet/drivers', 3),
    ('page', 'fleet.fuel', 'fleet', 'Fuel', '/fleet/fuel', 4),
    ('page', 'fleet.maintenance', 'fleet', 'Maintenance', '/fleet/maintenance', 5),
    ('page', 'fleet.locations', 'fleet', 'Locations', '/fleet/locations', 6),
    ('page', 'fleet.analytics', 'fleet', 'Analytics', '/fleet/analytics', 7),
    ('page', 'fleet.portal', 'fleet', 'Portal', '/fleet/portal', 8),
    ('page', 'fleet.investigation', 'fleet', 'Investigation', '/fleet/investigation', 9),
    ('page', 'fleet.check-in-audit', 'fleet', 'Check-in Audit', '/fleet/check-in/audit', 10),

    -- Communications pages
    ('page', 'communications.main', 'communications', 'Communications Hub', '/communications', 1),
    ('page', 'communications.whatsapp', 'communications', 'WhatsApp', '/communications/whatsapp', 2),
    ('page', 'communications.wishlist', 'communications', 'Wishlist', '/communications/wishlist', 3),
    ('page', 'communications.wa-monitor', 'communications', 'WA Monitor', '/wa-monitor', 4),
    ('page', 'communications.wa-dr-validation', 'communications', 'DR Validation', '/wa-monitor/dr-validation', 5),

    -- Analytics pages
    ('page', 'analytics.main', 'analytics', 'Analytics Dashboard', '/analytics', 1),
    ('page', 'analytics.reports', 'analytics', 'Reports', '/reports', 2),

    -- System pages
    ('page', 'system.settings', 'system', 'Settings', '/settings', 1),
    ('page', 'system.downloads', 'system', 'Downloads', '/downloads', 2),
    ('page', 'system.access-control', 'system', 'Access Control', '/settings/access-control', 3)
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEED: Common tabs (under pages)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    -- Procurement > Sourcing tabs
    ('tab', 'procurement.sourcing.suppliers', 'procurement.sourcing', 'Suppliers', 1),
    ('tab', 'procurement.sourcing.boq', 'procurement.sourcing', 'BOQ', 2),
    ('tab', 'procurement.sourcing.rfq', 'procurement.sourcing', 'RFQ', 3),

    -- Procurement > Purchasing tabs
    ('tab', 'procurement.purchasing.quotes', 'procurement.purchasing', 'Quotes', 1),
    ('tab', 'procurement.purchasing.requisitions', 'procurement.purchasing', 'Requisitions', 2),
    ('tab', 'procurement.purchasing.purchase-orders', 'procurement.purchasing', 'Purchase Orders', 3),
    ('tab', 'procurement.purchasing.grn', 'procurement.purchasing', 'GRN', 4),

    -- Procurement > Inventory tabs
    ('tab', 'procurement.inventory.stock', 'procurement.inventory', 'Stock', 1),
    ('tab', 'procurement.inventory.items', 'procurement.inventory', 'Items', 2),
    ('tab', 'procurement.inventory.categories', 'procurement.inventory', 'Categories', 3),
    ('tab', 'procurement.inventory.bundles', 'procurement.inventory', 'Bundles', 4),
    ('tab', 'procurement.inventory.stock-takes', 'procurement.inventory', 'Stock Takes', 5),
    ('tab', 'procurement.inventory.field-stock', 'procurement.inventory', 'Field Stock', 6),

    -- Activate tabs
    ('tab', 'activate.main.summary', 'activate.main', 'DR Summary', 1),
    ('tab', 'activate.main.qa-centre', 'activate.main', 'QA Centre', 2),
    ('tab', 'activate.main.reports', 'activate.main', 'Reports', 3),
    ('tab', 'activate.main.oes-import', 'activate.main', 'OES Import', 4),
    ('tab', 'activate.main.manual-entry', 'activate.main', 'Manual Entry', 5)
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SEED: Role permissions
-- =====================================================

-- Super Admin: Full access to everything
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: Full access except system.access-control delete
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: View all, create/edit most, no delete on sensitive
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'people.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        WHEN key LIKE 'procurement.approvals%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: View most, create/edit field-related
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key IN ('dashboard', 'dashboard.main', 'dashboard.daily-progress')
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'field.%' OR key LIKE 'activate.%' OR key LIKE 'maintenance.tickets%'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        WHEN key LIKE 'fleet.check-in%' OR key = 'fleet.portal'
            THEN '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'projects.%' OR key LIKE 'assets.%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: View only, no modifications
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key,
    CASE
        WHEN key LIKE 'system.access-control%' THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: Limited access to specific modules
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key,
    CASE
        WHEN key IN ('dashboard', 'dashboard.main')
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'projects.%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'field.%' OR key LIKE 'activate.%'
            THEN '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
        WHEN key = 'contractors' OR key LIKE 'contractors.%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- =====================================================
-- Helper function: Check if user has permission
-- =====================================================
CREATE OR REPLACE FUNCTION user_has_permission(
    p_user_id UUID,
    p_permission_key VARCHAR,
    p_action VARCHAR DEFAULT 'view'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_role VARCHAR;
    v_has_all BOOLEAN;
    v_role_action BOOLEAN;
    v_override_type VARCHAR;
    v_override_actions JSONB;
BEGIN
    -- 1. Check for legacy 'all' permission (super admin)
    SELECT permissions @> '["all"]'::jsonb INTO v_has_all
    FROM users WHERE id = p_user_id;

    IF v_has_all THEN RETURN TRUE; END IF;

    -- 2. Get user's role
    SELECT role INTO v_role FROM users WHERE id = p_user_id;
    IF v_role IS NULL THEN RETURN FALSE; END IF;

    -- 3. Check role-based permission
    SELECT (actions->>p_action)::boolean INTO v_role_action
    FROM role_permissions
    WHERE role = v_role AND permission_key = p_permission_key;

    -- 4. Check for user-specific override
    SELECT override_type, actions INTO v_override_type, v_override_actions
    FROM user_permission_overrides
    WHERE user_id = p_user_id
      AND permission_key = p_permission_key
      AND (expires_at IS NULL OR expires_at > NOW());

    -- Apply override if exists
    IF v_override_type = 'grant' AND (v_override_actions->>p_action)::boolean THEN
        RETURN TRUE;
    ELSIF v_override_type = 'revoke' AND (v_override_actions->>p_action)::boolean THEN
        RETURN FALSE;
    END IF;

    -- Return role-based permission (default false if not found)
    RETURN COALESCE(v_role_action, FALSE);
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Helper function: Get user's effective permissions
-- =====================================================
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE (
    permission_key VARCHAR,
    can_view BOOLEAN,
    can_create BOOLEAN,
    can_edit BOOLEAN,
    can_delete BOOLEAN
) AS $$
DECLARE
    v_role VARCHAR;
    v_has_all BOOLEAN;
BEGIN
    -- Check for super admin with 'all' permission
    SELECT permissions @> '["all"]'::jsonb INTO v_has_all
    FROM users WHERE id = p_user_id;

    IF v_has_all THEN
        RETURN QUERY
        SELECT
            ap.key::VARCHAR,
            TRUE, TRUE, TRUE, TRUE
        FROM access_permissions ap
        WHERE ap.is_active = true;
        RETURN;
    END IF;

    -- Get user's role
    SELECT role INTO v_role FROM users WHERE id = p_user_id;

    -- Return permissions based on role + overrides
    RETURN QUERY
    SELECT
        ap.key::VARCHAR,
        COALESCE(
            CASE
                WHEN upo.override_type = 'grant' THEN (upo.actions->>'view')::boolean
                WHEN upo.override_type = 'revoke' AND (upo.actions->>'view')::boolean THEN FALSE
                ELSE (rp.actions->>'view')::boolean
            END,
            FALSE
        ) as can_view,
        COALESCE(
            CASE
                WHEN upo.override_type = 'grant' THEN (upo.actions->>'create')::boolean
                WHEN upo.override_type = 'revoke' AND (upo.actions->>'create')::boolean THEN FALSE
                ELSE (rp.actions->>'create')::boolean
            END,
            FALSE
        ) as can_create,
        COALESCE(
            CASE
                WHEN upo.override_type = 'grant' THEN (upo.actions->>'edit')::boolean
                WHEN upo.override_type = 'revoke' AND (upo.actions->>'edit')::boolean THEN FALSE
                ELSE (rp.actions->>'edit')::boolean
            END,
            FALSE
        ) as can_edit,
        COALESCE(
            CASE
                WHEN upo.override_type = 'grant' THEN (upo.actions->>'delete')::boolean
                WHEN upo.override_type = 'revoke' AND (upo.actions->>'delete')::boolean THEN FALSE
                ELSE (rp.actions->>'delete')::boolean
            END,
            FALSE
        ) as can_delete
    FROM access_permissions ap
    LEFT JOIN role_permissions rp ON rp.permission_key = ap.key AND rp.role = v_role
    LEFT JOIN user_permission_overrides upo ON upo.permission_key = ap.key
        AND upo.user_id = p_user_id
        AND (upo.expires_at IS NULL OR upo.expires_at > NOW())
    WHERE ap.is_active = true;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- View: Permission tree for admin UI
-- =====================================================
CREATE OR REPLACE VIEW v_permission_tree AS
SELECT
    ap.id,
    ap.type,
    ap.key,
    ap.parent_key,
    ap.label,
    ap.description,
    ap.route,
    ap.sort_order,
    ap.is_active,
    parent.label as parent_label
FROM access_permissions ap
LEFT JOIN access_permissions parent ON ap.parent_key = parent.key
ORDER BY
    CASE ap.type
        WHEN 'module' THEN 1
        WHEN 'page' THEN 2
        WHEN 'tab' THEN 3
        WHEN 'action' THEN 4
    END,
    ap.sort_order;
