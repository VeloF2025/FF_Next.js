-- =====================================================
-- Migration 138: System Data Sync Permissions & Feature Settings
-- Adds granular RBAC permissions for System module pages and tabs
-- Creates feature settings table for quick toggles
-- =====================================================

-- =====================================================
-- 1. SYSTEM PAGES - Add if not exists
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order, description) VALUES
    ('page', 'system.health', 'system', 'System Health', '/system/health', 1, 'System health monitoring and status'),
    ('page', 'system.infrastructure', 'system', 'Infrastructure', '/system/infrastructure', 2, 'Infrastructure management'),
    ('page', 'system.data-sync', 'system', 'Data Sync', '/system/data-sync', 3, 'Data sync operations and imports')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    route = EXCLUDED.route,
    description = EXCLUDED.description;

-- =====================================================
-- 2. DATA SYNC TAB GROUPS
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.maintenance', 'system.data-sync', 'Maintenance', 1, 'QContact sync, alignments, weekly imports'),
    ('tab', 'system.data-sync.activate', 'system.data-sync', 'Activate', 2, 'OES/ARCH imports, manual DR entry'),
    ('tab', 'system.data-sync.olt', 'system.data-sync', 'OLT Report', 3, 'Nokia OLT report import and fixes'),
    ('tab', 'system.data-sync.qfield', 'system.data-sync', 'QField', 4, 'QFieldCloud project management'),
    ('tab', 'system.data-sync.history', 'system.data-sync', 'History', 5, 'Sync operation history')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 3. MAINTENANCE GROUP TABS (5 tabs)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.maintenance.qcontact', 'system.data-sync.maintenance', 'QContact Sync', 1, 'QContact ticket synchronization'),
    ('tab', 'system.data-sync.maintenance.alignment', 'system.data-sync.maintenance', 'QC Alignment', 2, 'QContact alignment report'),
    ('tab', 'system.data-sync.maintenance.three-way', 'system.data-sync.maintenance', '3-Way Alignment', 3, 'Three-way alignment report'),
    ('tab', 'system.data-sync.maintenance.weekly', 'system.data-sync.maintenance', 'Weekly Import', 4, 'Weekly report import'),
    ('tab', 'system.data-sync.maintenance.wa-tracking', 'system.data-sync.maintenance', 'Offline Tracking', 5, 'WhatsApp offline tracking')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 4. ACTIVATE GROUP TABS (3 tabs)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.activate.oes', 'system.data-sync.activate', 'OES Import', 1, 'OES activation import'),
    ('tab', 'system.data-sync.activate.arch', 'system.data-sync.activate', 'ARCH Import', 2, 'ARCH offline import'),
    ('tab', 'system.data-sync.activate.manual', 'system.data-sync.activate', 'Manual Entry', 3, 'Manual DR entry')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 5. OLT REPORT GROUP TABS (6 tabs)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.olt.import', 'system.data-sync.olt', 'Import', 1, 'OLT report import'),
    ('tab', 'system.data-sync.olt.pending', 'system.data-sync.olt', 'Fixable', 2, 'Pending serial fixes'),
    ('tab', 'system.data-sync.olt.investigate', 'system.data-sync.olt', 'Investigate', 3, 'Records needing investigation'),
    ('tab', 'system.data-sync.olt.escalations', 'system.data-sync.olt', 'Escalations', 4, 'Escalated issues'),
    ('tab', 'system.data-sync.olt.history', 'system.data-sync.olt', 'History', 5, 'Fix history'),
    ('tab', 'system.data-sync.olt.reporting', 'system.data-sync.olt', 'Reporting', 6, 'OLT reporting and export')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 6. QFIELD GROUP TABS (1 tab)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.qfield.projects', 'system.data-sync.qfield', 'Projects', 1, 'QFieldCloud projects management')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 7. HISTORY GROUP TABS (1 tab)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
    ('tab', 'system.data-sync.history.timeline', 'system.data-sync.history', 'Timeline', 1, 'Unified sync timeline')
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description;

-- =====================================================
-- 8. CREATE SYSTEM FEATURE SETTINGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS system_feature_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key VARCHAR(100) UNIQUE NOT NULL,
    enabled BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES users(id)
);

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_system_feature_settings_key ON system_feature_settings(feature_key);

-- =====================================================
-- 9. SEED DEFAULT FEATURE SETTINGS (all enabled by default)
-- =====================================================
INSERT INTO system_feature_settings (feature_key, enabled, config) VALUES
    -- Data Sync Groups
    ('system.data-sync.maintenance', true, '{"description": "Maintenance sync operations"}'::jsonb),
    ('system.data-sync.activate', true, '{"description": "Activate import operations"}'::jsonb),
    ('system.data-sync.olt', true, '{"description": "OLT report operations"}'::jsonb),
    ('system.data-sync.qfield', true, '{"description": "QField sync operations"}'::jsonb),
    ('system.data-sync.history', true, '{"description": "Sync history timeline"}'::jsonb),

    -- Maintenance Tabs
    ('system.data-sync.maintenance.qcontact', true, '{"description": "QContact sync"}'::jsonb),
    ('system.data-sync.maintenance.alignment', true, '{"description": "QC alignment report"}'::jsonb),
    ('system.data-sync.maintenance.three-way', true, '{"description": "3-way alignment"}'::jsonb),
    ('system.data-sync.maintenance.weekly', true, '{"description": "Weekly import"}'::jsonb),
    ('system.data-sync.maintenance.wa-tracking', true, '{"description": "WA offline tracking"}'::jsonb),

    -- Activate Tabs
    ('system.data-sync.activate.oes', true, '{"description": "OES import"}'::jsonb),
    ('system.data-sync.activate.arch', true, '{"description": "ARCH import"}'::jsonb),
    ('system.data-sync.activate.manual', true, '{"description": "Manual DR entry"}'::jsonb),

    -- OLT Tabs
    ('system.data-sync.olt.import', true, '{"description": "OLT import"}'::jsonb),
    ('system.data-sync.olt.pending', true, '{"description": "Pending fixes"}'::jsonb),
    ('system.data-sync.olt.investigate', true, '{"description": "Investigation"}'::jsonb),
    ('system.data-sync.olt.escalations', true, '{"description": "Escalations"}'::jsonb),
    ('system.data-sync.olt.history', true, '{"description": "Fix history"}'::jsonb),
    ('system.data-sync.olt.reporting', true, '{"description": "Reporting"}'::jsonb),

    -- QField Tabs
    ('system.data-sync.qfield.projects', true, '{"description": "QField projects"}'::jsonb),

    -- History Tabs
    ('system.data-sync.history.timeline', true, '{"description": "Sync timeline"}'::jsonb)
ON CONFLICT (feature_key) DO NOTHING;

-- =====================================================
-- 10. SEED ROLE PERMISSIONS FOR NEW ENTRIES
-- =====================================================

-- Super Admin: Full access
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key LIKE 'system.data-sync%' OR key IN ('system.health', 'system.infrastructure')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: Full access except delete on system settings
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key LIKE 'system.data-sync%' OR key IN ('system.health', 'system.infrastructure')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: View and edit only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key LIKE 'system.data-sync%' OR key IN ('system.health', 'system.infrastructure')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: View only for data-sync, no access to health/infrastructure
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key LIKE 'system.data-sync.activate%' OR key LIKE 'system.data-sync.maintenance%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'system.data-sync%' OR key IN ('system.health', 'system.infrastructure')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: View only for data-sync pages (not tabs or system pages)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key,
    CASE
        WHEN key = 'system.data-sync' THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key LIKE 'system.data-sync%' OR key IN ('system.health', 'system.infrastructure')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: No access to system pages
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key, '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key LIKE 'system.%'
ON CONFLICT (role, permission_key) DO NOTHING;
