-- Migration 326: payslips table + RBAC seed (PRD-040 Phase 3)
--
-- Stores payslips imported by HR (CSV summary + per-staff PDFs).
-- Per Hein's PRD-040 Phase 3 decisions:
--   - Source: manual CSV + PDF upload (no payroll-system API integration today).
--   - Retention: 5 years (SARS audit-friendly). archived_at flips visible
--     payslips to "archived" without dropping the audit row; staff /my/payslips
--     filters WHERE archived_at IS NULL. Hard delete is a separate decision
--     for a later cron, not this migration.
--   - Backfill: none on launch — first imported month onwards.
--
-- POPIA: payslips are personal financial data. Access gated by:
--   - staff_id match for staff viewing their own payslips (/my/payslips)
--   - payslips.import permission for HR upload + admin viewing

-- =============================================================================
-- STEP 1: payslips table
-- =============================================================================

CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,

  -- Pay period (inclusive on both ends, e.g. 2026-04-01 .. 2026-04-30).
  pay_period_start DATE NOT NULL,
  pay_period_end   DATE NOT NULL,

  -- Money in cents to avoid float weirdness. Per SA convention, ZAR.
  gross_cents      BIGINT NOT NULL CHECK (gross_cents >= 0),
  deductions_cents BIGINT NOT NULL CHECK (deductions_cents >= 0),
  net_cents        BIGINT NOT NULL CHECK (net_cents >= 0),

  -- VF Storage path to the per-staff payslip PDF, set by the import flow.
  -- Nullable because the CSV-only path may land before the PDF bundle.
  pdf_url TEXT,

  -- Original CSV row preserved as JSON so the staff-side detail view can show
  -- line items (medical aid, UIF, PAYE, leave accruals) without re-parsing.
  raw_data JSONB,

  -- Audit trail for the import event itself. imported_by points at
  -- users(id) — the admin who ran the import, not a staff record.
  -- (Migration 327 fixed this on systems that already applied 326 with
  -- the wrong staff(id) FK.)
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Retention: archived_at is NULL while the payslip is visible to staff.
  -- A retention job sets it 5 years after pay_period_end. Setting it does
  -- NOT delete the row — auditors can still query historic data — it just
  -- hides the payslip from /my/payslips and the HR list view.
  archived_at TIMESTAMPTZ,

  -- One payslip per staff per period — re-uploads must explicitly UPDATE,
  -- not silently insert duplicates.
  UNIQUE (staff_id, pay_period_start, pay_period_end),

  -- Sanity: end >= start, net = gross - deductions (rounding tolerated within R0.01).
  CHECK (pay_period_end >= pay_period_start),
  CHECK (ABS(net_cents - (gross_cents - deductions_cents)) <= 1)
);

-- Staff viewer query: list active payslips for the signed-in staff, latest first.
CREATE INDEX IF NOT EXISTS idx_payslips_staff_active
  ON payslips (staff_id, pay_period_start DESC)
  WHERE archived_at IS NULL;

-- Retention job: find non-archived payslips whose pay_period_end has aged out.
CREATE INDEX IF NOT EXISTS idx_payslips_retention_scan
  ON payslips (pay_period_end)
  WHERE archived_at IS NULL;

-- Admin import flow: lookup by period for "what did we import for April 2026?"
CREATE INDEX IF NOT EXISTS idx_payslips_period
  ON payslips (pay_period_start, pay_period_end);

COMMENT ON TABLE payslips IS
  'PRD-040 Phase 3: monthly payslips imported by HR. POPIA-restricted personal financial data.';
COMMENT ON COLUMN payslips.archived_at IS
  'NULL = visible to staff. Set 5 years after pay_period_end by the retention job. Row is preserved for audit.';
COMMENT ON COLUMN payslips.raw_data IS
  'Original CSV row payload (line items: medical aid, UIF, PAYE, leave accruals, etc.) for the detail view.';

-- ---------------------------------------------------------------------------
-- GRANTs — app runs as fibreflow_user (migration 310 pattern).
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES
  ON payslips TO fibreflow_user;

-- =============================================================================
-- STEP 2: RBAC — payslips.import (HR-only)
-- =============================================================================

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('module', 'payslips', NULL,
   'Payslips',
   'Monthly payslip import + admin viewing. Staff see their own at /my/payslips.',
   NULL, 17, true),

  ('page', 'payslips.import', 'payslips',
   'Import Payslips',
   'Upload monthly CSV summary + per-staff PDFs.',
   '/staff/payslips/import', 1, true)

ON CONFLICT (key) DO NOTHING;

-- HR-only page. Aligned with billing.* — super_admin + admin only by default.
-- Manager and others are explicitly denied so the policy is auditable rather
-- than "default deny" behaviour from the absence of a row.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  -- payslips module
  ('super_admin',     'payslips',         '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'payslips',         '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',         'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',      'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'payslips',         '{"view":false,"create":false,"edit":false,"delete":false}'),

  -- payslips.import page
  ('super_admin',     'payslips.import',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('admin',           'payslips.import',  '{"view":true,"create":true,"edit":true,"delete":true}'),
  ('manager',         'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('technician',      'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('viewer',          'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('contractor',      'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('storeman',        'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('project_manager', 'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('qa_manager',      'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('site_supervisor', 'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}'),
  ('client',          'payslips.import',  '{"view":false,"create":false,"edit":false,"delete":false}')

ON CONFLICT (role, permission_key) DO NOTHING;
