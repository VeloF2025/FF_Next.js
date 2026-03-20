-- =====================================================
-- Migration 247: RBAC - Add missing modules, pages, tabs
-- Brings access_permissions in sync with all current app features
-- =====================================================

BEGIN;

-- =====================================================
-- 1. NEW MODULES
-- =====================================================
INSERT INTO access_permissions (type, key, label, description, sort_order) VALUES
    ('module', 'noc', 'NOC', 'Network Operations Centre - tickets, escalations, fault management', 15),
    ('module', 'accounting', 'Accounting', 'Financial accounting, GL, journals, Sage integration', 16),
    ('module', 'field-ops', 'Field Operations', 'Construction QA, civil QA, field inspections', 17),
    ('module', 'sow', 'SOW', 'Statement of Work data management', 18)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    sort_order = EXCLUDED.sort_order;

-- =====================================================
-- 2. NEW PAGES - NOC
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'noc.main', 'noc', 'NOC Dashboard', 'Main NOC ticket list and overview', '/noc', 1),
    ('page', 'noc.tickets', 'noc', 'Tickets', 'Fault tickets and incident management', '/noc/tickets', 2),
    ('page', 'noc.escalations', 'noc', 'Escalations', 'Ticket escalation management', '/noc/escalations', 3),
    ('page', 'noc.teams', 'noc', 'Teams', 'NOC team management', '/noc/teams', 4),
    ('page', 'noc.handovers', 'noc', 'Handovers', 'Shift handover management', '/noc/handovers', 5),
    ('page', 'noc.risk-acceptances', 'noc', 'Risk Acceptances', 'Risk acceptance tracking', '/noc/risk-acceptances', 6),
    ('page', 'noc.wa-tracking', 'noc', 'WA Tracking', 'WhatsApp-based ticket tracking', '/noc/wa-tracking', 7),
    ('page', 'noc.imports', 'noc', 'Weekly Imports', 'Weekly fault report imports', '/noc/imports', 8)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 3. NEW PAGES - Accounting
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'accounting.main', 'accounting', 'Accounting Dashboard', 'Financial overview and GL', '/accounting', 1),
    ('page', 'accounting.journals', 'accounting', 'Journals', 'GL journal entries', '/accounting/journals', 2),
    ('page', 'accounting.reports', 'accounting', 'Reports', 'Financial reports (P&L, cost breakdown)', '/accounting/reports', 3),
    ('page', 'accounting.sage-sync', 'accounting', 'Sage Sync', 'Sage Business Cloud integration', '/accounting/sage-sync', 4)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 4. NEW PAGES - Field Operations (Construction QA)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'field-ops.main', 'field-ops', 'Field Ops Dashboard', 'Construction QA overview', '/field-ops', 1),
    ('page', 'field-ops.reviews', 'field-ops', 'Reviews', 'Construction QA photo reviews', '/field-ops/reviews', 2),
    ('page', 'field-ops.otdr', 'field-ops', 'OTDR', 'Optical time-domain reflectometer results', '/field-ops/otdr', 3),
    ('page', 'field-ops.reports', 'field-ops', 'Reports', 'Field operations reports', '/field-ops/reports', 4)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 5. NEW PAGES - System (missing entries)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'system.health', 'system', 'System Health', 'Service health monitoring', '/system/health', 4),
    ('page', 'system.infrastructure', 'system', 'Infrastructure', 'Server and service management', '/system/infrastructure', 5),
    ('page', 'system.data-sync', 'system', 'Data Sync', 'Odoo/external data synchronisation', '/system/data-sync', 6),
    ('page', 'system.vlm-learning', 'system', 'VLM Learning', 'Vision language model training/corrections', '/system/vlm-learning', 7),
    ('page', 'system.deployment', 'system', 'Deployment', 'Deployment health and status', '/deployment', 8)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 6. NEW PAGES - Communications (missing entries)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'communications.help-center', 'communications', 'Help Center', 'User documentation and guides', '/communications/help-center', 6),
    ('page', 'communications.mission-control', 'communications', 'Mission Control', 'Agent fleet monitoring', '/communications/mission-control', 7),
    ('page', 'communications.dev-queue', 'communications', 'Dev Queue', 'Development task queue', '/communications/dev-queue', 8)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 7. NEW PAGES - Procurement (missing entries)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'procurement.field-stock', 'procurement', 'Field Stock', 'Field stock management and picking', '/procurement/field-stock', 7),
    ('page', 'procurement.stock-portal', 'procurement', 'Stock Portal', 'Stock issuance portal', '/stock/portal', 8),
    ('page', 'procurement.reports', 'procurement', 'Reports', 'Procurement analytics and reports', '/procurement/reports', 9),
    ('page', 'procurement.workflow', 'procurement', 'Workflow', 'Approval workflow management', '/procurement/workflow', 10),
    ('page', 'procurement.open-orders', 'procurement', 'Open Orders', 'Outstanding purchase orders', '/procurement/open-orders', 11),
    ('page', 'procurement.audit', 'procurement', 'Audit', 'Procurement audit trail', '/procurement/audit', 12)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 8. NEW PAGES - Fleet (missing entries)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'fleet.check-in', 'fleet', 'Check-In', 'Vehicle daily check-in', '/fleet/check-in', 11),
    ('page', 'fleet.check-in.history', 'fleet', 'Check-In History', 'Historical check-in records', '/fleet/check-in/history', 12),
    ('page', 'fleet.check-in.templates', 'fleet', 'Check-In Templates', 'Manage check-in form templates', '/fleet/check-in/templates', 13)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 9. NEW PAGES - SOW
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'sow.main', 'sow', 'SOW Data', 'Statement of Work data viewer', '/sow', 1),
    ('page', 'sow.import', 'sow', 'SOW Import', 'Import poles, drops, fibre data', '/sow/import', 2)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 10. NEW PAGES - Activate (missing entries)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order) VALUES
    ('page', 'activate.reporting', 'activate', 'Reporting', 'Activation and penetration reports', '/activate/reporting', 5)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    route = EXCLUDED.route;

-- =====================================================
-- 11. NEW TABS - NOC
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    ('tab', 'noc.tickets.my-tickets', 'noc.tickets', 'My Tickets', 1),
    ('tab', 'noc.tickets.my-team', 'noc.tickets', 'My Team', 2),
    ('tab', 'noc.tickets.all', 'noc.tickets', 'All Tickets', 3),
    ('tab', 'noc.tickets.grid', 'noc.tickets', 'Grid View', 4)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label;

-- =====================================================
-- 12. NEW TABS - Procurement (missing)
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    ('tab', 'procurement.inventory.field-stock.reconciliation', 'procurement.inventory.field-stock', 'Reconciliation', 1),
    ('tab', 'procurement.purchasing.open-orders', 'procurement.purchasing', 'Open Orders', 5)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label;

-- =====================================================
-- 13. NEW TABS - Fleet
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    ('tab', 'fleet.check-in.daily', 'fleet.check-in', 'Daily Check-In', 1),
    ('tab', 'fleet.check-in.history', 'fleet.check-in', 'History', 2),
    ('tab', 'fleet.check-in.templates', 'fleet.check-in', 'Templates', 3)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label;

-- =====================================================
-- 14. NEW TABS - Activate
-- =====================================================
INSERT INTO access_permissions (type, key, parent_key, label, sort_order) VALUES
    ('tab', 'activate.main.dr-list', 'activate.main', 'DR List', 6),
    ('tab', 'activate.main.penetration', 'activate.main', 'Penetration Curve', 7)
ON CONFLICT (key) DO UPDATE SET
    label = EXCLUDED.label;

-- =====================================================
-- 15. ROLE PERMISSIONS for new entries
-- Auto-grant to super_admin, admin, manager, viewer
-- =====================================================

-- Super Admin: full access to all new permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'super_admin')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Admin: full access (no delete on system)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
    END
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'admin')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Manager: view all, create/edit most, no delete
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'accounting.%' THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'manager')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Storeman: stock/procurement/fleet focus
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'storeman', key,
    CASE
        WHEN key IN ('dashboard', 'dashboard.main')
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'procurement.%' OR key LIKE 'assets.%'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        WHEN key LIKE 'fleet.check-in%' OR key = 'fleet.portal'
            THEN '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'projects.%' OR key LIKE 'sow.%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
ON CONFLICT (role, permission_key) DO NOTHING;

-- Technician: add new modules they need
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key LIKE 'noc.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        WHEN key LIKE 'field-ops.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        WHEN key LIKE 'sow.%' THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'technician')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Viewer: view-only on all new permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'viewer')
ON CONFLICT (role, permission_key) DO NOTHING;

-- Contractor: limited view on new modules
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key,
    CASE
        WHEN key LIKE 'field-ops.%' OR key LIKE 'sow.%'
            THEN '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
        WHEN key LIKE 'noc.%'
            THEN '{"view": true, "create": true, "edit": false, "delete": false}'::jsonb
        ELSE '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key NOT IN (SELECT permission_key FROM role_permissions WHERE role = 'contractor')
ON CONFLICT (role, permission_key) DO NOTHING;

COMMIT;
