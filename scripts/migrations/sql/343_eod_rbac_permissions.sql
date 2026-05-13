-- Migration 343: Register EOD tab and sub-tabs in access_permissions
-- and grant view/create/edit to admin + manager (matching sibling tabs).
--
-- Before this migration, system.data-sync.eod existed in code but not in DB,
-- so can('system.data-sync.eod', 'view') returned false for all non-super_admin
-- users, hiding the EOD group entirely.

BEGIN;

-- ── 1. access_permissions ────────────────────────────────────────────────────

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('tab',  'system.data-sync.eod',               'system.data-sync',               'EOD',            'End-of-Day install sheet upload and reconciliation', NULL, 7, true),
  ('tab',  'system.data-sync.eod.upload',         'system.data-sync.eod',           'Upload',         'Upload EOD install sheet photos or PDFs',            NULL, 1, true),
  ('tab',  'system.data-sync.eod.reconciliation', 'system.data-sync.eod',           'Reconciliation', '3-way reconciliation against WA DRs and OES',        NULL, 2, true),
  ('tab',  'system.data-sync.eod.history',        'system.data-sync.eod',           'History',        'Uploaded EOD sheet history',                          NULL, 3, true)
ON CONFLICT (key) DO NOTHING;

-- ── 2. role_permissions ──────────────────────────────────────────────────────
-- Pattern mirrors system.data-sync.activate and system.data-sync.billing:
--   super_admin → full, admin/manager → view+create+edit, contractor/storeman → all false

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  -- EOD group
  ('super_admin', 'system.data-sync.eod',               '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'system.data-sync.eod',               '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',     'system.data-sync.eod',               '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',  'system.data-sync.eod',               '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'system.data-sync.eod',               '{"view":false,"create":false,"edit":false,"delete":false}'),
  -- Upload tab
  ('super_admin', 'system.data-sync.eod.upload',        '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'system.data-sync.eod.upload',        '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',     'system.data-sync.eod.upload',        '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',  'system.data-sync.eod.upload',        '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'system.data-sync.eod.upload',        '{"view":false,"create":false,"edit":false,"delete":false}'),
  -- Reconciliation tab
  ('super_admin', 'system.data-sync.eod.reconciliation','{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'system.data-sync.eod.reconciliation','{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',     'system.data-sync.eod.reconciliation','{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',  'system.data-sync.eod.reconciliation','{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'system.data-sync.eod.reconciliation','{"view":false,"create":false,"edit":false,"delete":false}'),
  -- History tab
  ('super_admin', 'system.data-sync.eod.history',       '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',       'system.data-sync.eod.history',       '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('manager',     'system.data-sync.eod.history',       '{"view":true,"create":true,"edit":true,"delete":false}'),
  ('contractor',  'system.data-sync.eod.history',       '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',    'system.data-sync.eod.history',       '{"view":false,"create":false,"edit":false,"delete":false}')
ON CONFLICT (role, permission_key) DO NOTHING;

COMMIT;
