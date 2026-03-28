-- Migration 260: FiberTime Billing Reconciliation
-- Tracks weekly FT payment summaries, deductions, and DR payment status
--
-- Tables:
--   ft_weekly_billing       - One row per (week_ending, project) with FT payment summary numbers
--   ft_billing_deductions   - Individual deducted DR numbers per week with reason
--   oes_activations         - ALTER: add payment_status, payment_week, payment_note
--
-- CRITICAL RULES:
--   1. Never sum weekly deduction counts across weeks (they're cumulative snapshots)
--   2. "Currently unpaid" = DISTINCT dr_number from latest week's ft_billing_deductions
--   3. Always anchor to latest week, never aggregate across weeks

-- ─── ft_weekly_billing ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ft_weekly_billing (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_ending                 DATE NOT NULL,
  project                     VARCHAR(100) NOT NULL,

  -- FT payment summary numbers (from uploaded PDF) - display-only snapshots
  ft_total_onts               INTEGER NOT NULL DEFAULT 0,
  ft_previously_invoiced      INTEGER NOT NULL DEFAULT 0,
  ft_claimable                INTEGER NOT NULL DEFAULT 0,
  ft_note1_count              INTEGER NOT NULL DEFAULT 0,
  ft_note2_count              INTEGER NOT NULL DEFAULT 0,
  ft_note3_count              INTEGER NOT NULL DEFAULT 0,
  ft_note4_count              INTEGER NOT NULL DEFAULT 0,
  ft_note5_count              INTEGER NOT NULL DEFAULT 0,
  ft_pre_provisions_count     INTEGER NOT NULL DEFAULT 0,
  ft_total_claimable          INTEGER NOT NULL DEFAULT 0,

  -- Invoice computation
  price_per_drop              DECIMAL(10,2),
  tax_rate                    DECIMAL(5,2) DEFAULT 15.00,
  invoice_subtotal            DECIMAL(15,2),
  invoice_total               DECIMAL(15,2),

  -- Our OES counts (populated by reconciliation)
  our_total_activations       INTEGER,
  our_claimable               INTEGER,
  our_note1_count             INTEGER,
  our_note2_count             INTEGER,
  our_note3_count             INTEGER,
  our_note4_count             INTEGER,
  our_note5_count             INTEGER,
  our_pre_provisions_count    INTEGER,

  -- Variance (our - FT)
  variance_claimable          INTEGER,
  variance_total_onts         INTEGER,

  -- Status
  reconciliation_status       VARCHAR(30) DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending', 'reconciled', 'disputed')),
  reconciled_at               TIMESTAMPTZ,
  reconciled_by               TEXT,

  -- Source tracking
  pdf_filename                TEXT,
  notes_xlsx_filename         TEXT,
  uploaded_by                 TEXT,
  uploaded_at                 TIMESTAMPTZ DEFAULT NOW(),

  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(week_ending, project)
);

CREATE INDEX IF NOT EXISTS idx_ft_weekly_billing_week    ON ft_weekly_billing(week_ending DESC);
CREATE INDEX IF NOT EXISTS idx_ft_weekly_billing_project ON ft_weekly_billing(project);
CREATE INDEX IF NOT EXISTS idx_ft_weekly_billing_status  ON ft_weekly_billing(reconciliation_status);

-- ─── ft_billing_deductions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ft_billing_deductions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_week_id     UUID NOT NULL REFERENCES ft_weekly_billing(id) ON DELETE CASCADE,
  week_ending         DATE NOT NULL,
  project             VARCHAR(100) NOT NULL,
  dr_number           VARCHAR(50) NOT NULL,
  deduction_note      VARCHAR(10) NOT NULL
    CHECK (deduction_note IN ('note1', 'note2', 'note3', 'note4', 'note5')),
  serial_number       VARCHAR(100),
  team                VARCHAR(50),
  deduction_reason    TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(billing_week_id, dr_number, deduction_note)
);

CREATE INDEX IF NOT EXISTS idx_ft_billing_deductions_week    ON ft_billing_deductions(billing_week_id);
CREATE INDEX IF NOT EXISTS idx_ft_billing_deductions_dr      ON ft_billing_deductions(dr_number);
CREATE INDEX IF NOT EXISTS idx_ft_billing_deductions_project ON ft_billing_deductions(project);
CREATE INDEX IF NOT EXISTS idx_ft_billing_deductions_note    ON ft_billing_deductions(deduction_note);

-- ─── ALTER oes_activations ──────────────────────────────────────────────────

ALTER TABLE oes_activations
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) DEFAULT 'not_yet_claimed'
    CHECK (payment_status IN ('not_yet_claimed', 'pre_provisioned', 'paid', 'deducted', 'disputed')),
  ADD COLUMN IF NOT EXISTS payment_week   DATE,
  ADD COLUMN IF NOT EXISTS payment_note   VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_oes_activations_payment_status ON oes_activations(payment_status);
CREATE INDEX IF NOT EXISTS idx_oes_activations_payment_week   ON oes_activations(payment_week);

-- ─── RBAC Permissions ───────────────────────────────────────────────────────

INSERT INTO access_permissions (type, key, parent_key, label, sort_order, description) VALUES
  ('tab', 'system.data-sync.billing',           'system.data-sync',         'Billing',         6, 'FiberTime billing reconciliation'),
  ('tab', 'system.data-sync.billing.upload',     'system.data-sync.billing', 'Upload',          1, 'Upload weekly payment summary PDF'),
  ('tab', 'system.data-sync.billing.summary',    'system.data-sync.billing', 'Weekly Summary',  2, 'Weekly billing summary and metrics'),
  ('tab', 'system.data-sync.billing.dr-status',  'system.data-sync.billing', 'DR Status',       3, 'DR payment status tracking')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

-- Feature settings
INSERT INTO system_feature_settings (feature_key, enabled, config) VALUES
  ('system.data-sync.billing',          true, '{"description": "FiberTime billing reconciliation"}'::jsonb),
  ('system.data-sync.billing.upload',   true, '{"description": "Upload weekly payment summary PDF"}'::jsonb),
  ('system.data-sync.billing.summary',  true, '{"description": "Weekly billing summary and metrics"}'::jsonb),
  ('system.data-sync.billing.dr-status',true, '{"description": "DR payment status tracking"}'::jsonb)
ON CONFLICT (feature_key) DO NOTHING;

-- Role permissions
INSERT INTO role_permissions (role, permission_key, actions)
SELECT r.role, ap.key,
  CASE r.role
    WHEN 'super_admin' THEN '{"view":true,"create":true,"edit":true,"delete":true}'
    WHEN 'admin'       THEN '{"view":true,"create":true,"edit":true,"delete":false}'
    WHEN 'manager'     THEN '{"view":true,"create":true,"edit":true,"delete":false}'
    ELSE                    '{"view":false,"create":false,"edit":false,"delete":false}'
  END::jsonb
FROM (VALUES ('super_admin'),('admin'),('manager'),('technician'),('viewer'),('contractor')) AS r(role)
CROSS JOIN access_permissions ap
WHERE ap.key LIKE 'system.data-sync.billing%'
ON CONFLICT (role, permission_key) DO NOTHING;
