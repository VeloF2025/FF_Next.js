-- Migration 221: RBAC Sync — Latest Modules
-- Brings access_permissions and role_permissions in sync with current nav/module structure.
-- All INSERTs are idempotent (ON CONFLICT DO NOTHING).

-- ============================================================
-- SECTION 1: Accounting module + 10 sub-pages
-- ============================================================

INSERT INTO access_permissions (type, key, label, description, sort_order) VALUES
    ('module', 'accounting', 'Accounting', 'Financial accounting and reporting', 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'accounting.dashboard',        'accounting', 'Dashboard',           '/accounting',               1),
    ('page', 'accounting.customers',        'accounting', 'Customers (AR)',      '/accounting/customers',     2),
    ('page', 'accounting.suppliers',        'accounting', 'Suppliers (AP)',      '/accounting/suppliers',     3),
    ('page', 'accounting.items',            'accounting', 'Items',              '/accounting/items',         4),
    ('page', 'accounting.banking',          'accounting', 'Banking',            '/accounting/banking',       5),
    ('page', 'accounting.accounts',         'accounting', 'Chart of Accounts',  '/accounting/accounts',      6),
    ('page', 'accounting.vat',              'accounting', 'VAT',                '/accounting/vat',           7),
    ('page', 'accounting.accountants-area', 'accounting', 'Accountants Area',   '/accounting/accountants-area', 8),
    ('page', 'accounting.reports',          'accounting', 'Reports',            '/accounting/reports',       9),
    ('page', 'accounting.data-import',      'accounting', 'Data Import',        '/accounting/data-import',  10)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 2: Re-add 14 missing pages from migration 097 seed
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'activate.photo-review',           'activate',       'Photo Review',        '/activate/photo-review',       10),
    ('page', 'dashboard.enhanced-kpis',         'dashboard',      'Enhanced KPIs',       '/dashboard/enhanced-kpis',      5),
    ('page', 'dashboard.kpi-dashboard',         'dashboard',      'KPI Dashboard',       '/dashboard/kpi-dashboard',      6),
    ('page', 'assets.checkout',                 'assets',         'Checkout',            '/assets/checkout',              5),
    ('page', 'assets.calibration',              'assets',         'Calibration',         '/assets/calibration',           6),
    ('page', 'field.main',                      'field',          'Field Main',          '/field',                        1),
    ('page', 'field.tasks',                     'field',          'Tasks',               '/field/tasks',                  2),
    ('page', 'field.nokia-equipment',           'field',          'Nokia Equipment',     '/field/nokia-equipment',        3),
    ('page', 'field.marketing',                 'field',          'Marketing',           '/field/marketing',              4),
    ('page', 'contractors.rag-dashboard',       'contractors',    'RAG Dashboard',       '/contractors/rag-dashboard',    5),
    ('page', 'procurement.financial',           'procurement',    'Financial',           '/procurement/financial',        8),
    ('page', 'communications.wishlist',         'communications', 'Wishlist',            '/communications/wishlist',      5),
    ('page', 'communications.wa-monitor',       'communications', 'WA Monitor',         '/communications/wa-monitor',    6),
    ('page', 'communications.wa-dr-validation', 'communications', 'WA DR Validation',   '/communications/wa-dr-validation', 7)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 3: Nav rbacKeys with no DB entry
-- ============================================================

INSERT INTO access_permissions (type, key, parent_key, label, route, sort_order) VALUES
    ('page', 'communications.mission-control', 'communications', 'Mission Control',  '/communications/mission-control', 1),
    ('page', 'system.deployment',              'system',         'Deployment',        '/system/deployment',              5),
    ('page', 'system.infrastructure',          'system',         'Infrastructure',    '/system/infrastructure',          6)
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SECTION 4: Seed role_permissions for ALL new keys
-- ============================================================

-- 4a. super_admin — full CRUD on everything
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'super_admin', key, '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
FROM access_permissions
WHERE key IN (
    -- accounting
    'accounting', 'accounting.dashboard', 'accounting.customers', 'accounting.suppliers',
    'accounting.items', 'accounting.banking', 'accounting.accounts', 'accounting.vat',
    'accounting.accountants-area', 'accounting.reports', 'accounting.data-import',
    -- re-added from 097
    'activate.photo-review', 'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'assets.checkout', 'assets.calibration',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard', 'procurement.financial',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    -- nav gaps
    'communications.mission-control', 'system.deployment', 'system.infrastructure'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4b. admin — full CRUD, except no delete on system.*
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'admin', key,
    CASE
        WHEN key LIKE 'system.%' THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb
    END
FROM access_permissions
WHERE key IN (
    'accounting', 'accounting.dashboard', 'accounting.customers', 'accounting.suppliers',
    'accounting.items', 'accounting.banking', 'accounting.accounts', 'accounting.vat',
    'accounting.accountants-area', 'accounting.reports', 'accounting.data-import',
    'activate.photo-review', 'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'assets.checkout', 'assets.calibration',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard', 'procurement.financial',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    'communications.mission-control', 'system.deployment', 'system.infrastructure'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4c. manager — view + create + edit (no delete)
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'manager', key, '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'accounting', 'accounting.dashboard', 'accounting.customers', 'accounting.suppliers',
    'accounting.items', 'accounting.banking', 'accounting.accounts', 'accounting.vat',
    'accounting.accountants-area', 'accounting.reports', 'accounting.data-import',
    'activate.photo-review', 'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'assets.checkout', 'assets.calibration',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard', 'procurement.financial',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    'communications.mission-control'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4d. technician — view only for accounting, CRUD for field/activate pages
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'technician', key,
    CASE
        WHEN key LIKE 'field.%' OR key LIKE 'activate.%'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key IN (
    'accounting', 'accounting.dashboard', 'accounting.customers', 'accounting.suppliers',
    'accounting.items', 'accounting.banking', 'accounting.accounts', 'accounting.vat',
    'accounting.accountants-area', 'accounting.reports', 'accounting.data-import',
    'activate.photo-review',
    'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'assets.checkout', 'assets.calibration',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard', 'procurement.financial',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    'communications.mission-control'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4e. viewer — view only
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'viewer', key, '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
FROM access_permissions
WHERE key IN (
    'accounting', 'accounting.dashboard', 'accounting.customers', 'accounting.suppliers',
    'accounting.items', 'accounting.banking', 'accounting.accounts', 'accounting.vat',
    'accounting.accountants-area', 'accounting.reports', 'accounting.data-import',
    'activate.photo-review', 'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'assets.checkout', 'assets.calibration',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard', 'procurement.financial',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    'communications.mission-control'
)
ON CONFLICT (role, permission_key) DO NOTHING;

-- 4f. contractor — no accounting access, view only for field/activate
INSERT INTO role_permissions (role, permission_key, actions)
SELECT 'contractor', key,
    CASE
        WHEN key LIKE 'field.%' OR key LIKE 'activate.%'
            THEN '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb
        ELSE '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb
    END
FROM access_permissions
WHERE key IN (
    'activate.photo-review',
    'field.main', 'field.tasks', 'field.nokia-equipment', 'field.marketing',
    'contractors.rag-dashboard',
    'dashboard.enhanced-kpis', 'dashboard.kpi-dashboard',
    'communications.wishlist', 'communications.wa-monitor', 'communications.wa-dr-validation',
    'communications.mission-control'
)
ON CONFLICT (role, permission_key) DO NOTHING;
