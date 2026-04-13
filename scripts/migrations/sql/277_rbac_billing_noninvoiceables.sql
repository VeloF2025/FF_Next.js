-- Migration 277: Add RBAC permissions for billing and non-invoiceables modules
--
-- Gap found in RBAC audit (2026-04-13): billing and non-invoiceables exist in code
-- but had no entries in access_permissions or role_permissions.
-- Access was enforced only by UI nav guard (super_admin role check), not at DB level.
--
-- billing:           Finance tab — super_admin + admin only (matches PR #871 intent)
-- non-invoiceables:  Activate sub-page — same access as parent activate module

-- ---------------------------------------------------------------------------
-- 1. access_permissions
-- ---------------------------------------------------------------------------

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  -- Billing: top-level module (Finance tab in sidebar)
  ('module', 'billing', NULL,
   'Billing', 'FT weekly billing reconciliation and Finance reporting',
   NULL, 16, true),

  -- Billing pages
  ('page', 'billing.main', 'billing',
   'Weekly Summary', 'Weekly FT payment summary and zone uptake',
   '/billing', 1, true),

  ('page', 'billing.dr-history', 'billing',
   'DR History', 'DR payment history',
   '/billing/dr-history', 2, true),

  -- Non-invoiceables: page under activate
  ('page', 'activate.non-invoiceables', 'activate',
   'Action Centre', 'Non-invoiceable items — pre-provisions, serial mismatches, offline devices, billing deductions',
   '/activate/non-invoiceables', 20, true)

ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. role_permissions for billing
--    super_admin + admin: full access
--    everyone else: no access (Finance is restricted by design)
-- ---------------------------------------------------------------------------

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  -- billing module
  ('super_admin', 'billing',       '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'billing',       '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',     'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',  'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',      'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',  'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'billing',   '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',  'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'billing',   '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',      'billing',       '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- billing.main page
  ('super_admin', 'billing.main',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'billing.main',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',     'billing.main',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',  'billing.main',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',      'billing.main',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',  'billing.main',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'billing.main',  '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- billing.dr-history page
  ('super_admin', 'billing.dr-history', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('admin',       'billing.dr-history', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('manager',     'billing.dr-history', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',  'billing.dr-history', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',      'billing.dr-history', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',  'billing.dr-history', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'billing.dr-history', '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- activate.non-invoiceables page (same roles as activate module)
  ('super_admin', 'activate.non-invoiceables', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'activate.non-invoiceables', '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',     'activate.non-invoiceables', '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('technician',  'activate.non-invoiceables', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('viewer',      'activate.non-invoiceables', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('contractor',  'activate.non-invoiceables', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'activate.non-invoiceables', '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'activate.non-invoiceables', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',  'activate.non-invoiceables', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'activate.non-invoiceables', '{"view":true,"create":false,"edit":false,"delete":false}'),
  ('client',      'activate.non-invoiceables', '{"view":false,"create":false,"edit":false,"delete":false}')

ON CONFLICT (role, permission_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- SELECT key, type, label FROM access_permissions WHERE key LIKE 'billing%' OR key = 'activate.non-invoiceables';
-- SELECT role, actions FROM role_permissions WHERE permission_key = 'billing' ORDER BY role;
