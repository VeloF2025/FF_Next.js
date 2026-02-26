-- Migration 215: Depreciation schedules + Audit trail
-- Phase 2 accounting features

-- ── Depreciation Schedules ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS depreciation_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code VARCHAR(50) NOT NULL,
  asset_name VARCHAR(100) NOT NULL,
  asset_category VARCHAR(50),
  gl_asset_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  gl_depreciation_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  gl_expense_account_id UUID NOT NULL REFERENCES gl_accounts(id),
  purchase_date DATE NOT NULL,
  cost NUMERIC(15,2) NOT NULL CHECK (cost > 0),
  salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL CHECK (useful_life_months > 0),
  depreciation_method VARCHAR(30) NOT NULL DEFAULT 'straight_line'
    CHECK (depreciation_method IN ('straight_line', 'declining_balance')),
  accumulated_depreciation NUMERIC(15,2) NOT NULL DEFAULT 0,
  last_depreciation_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dep_sched_active ON depreciation_schedules(is_active)
  WHERE is_active = true;

-- ── Depreciation Run History ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES depreciation_schedules(id) ON DELETE CASCADE,
  run_date DATE NOT NULL,
  fiscal_period_id UUID REFERENCES fiscal_periods(id),
  depreciation_amount NUMERIC(15,2) NOT NULL,
  accumulated_total NUMERIC(15,2) NOT NULL,
  gl_journal_entry_id UUID REFERENCES gl_journal_entries(id),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dep_runs_schedule ON depreciation_runs(schedule_id);

-- ── Accounting Activity Log (Audit Trail) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  action VARCHAR(30) NOT NULL,
  description TEXT,
  old_values JSONB,
  new_values JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aal_entity ON accounting_activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_aal_changed_at ON accounting_activity_log(changed_at);
