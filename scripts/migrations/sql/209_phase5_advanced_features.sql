-- Migration 209: Phase 5 Advanced Features
-- Cost Centres (Analysis Codes), Budget Management, DRC VAT

-- ── Cost Centres ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cost_centres (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(20) NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  department      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cc_active ON cost_centres(is_active, code);

-- Add FK constraint to existing cost_center_id columns
-- (only if the column exists and has no constraint yet)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gl_journal_lines' AND column_name = 'cost_center_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'gl_journal_lines' AND ccu.column_name = 'cost_center_id' AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE gl_journal_lines
      ADD CONSTRAINT fk_jl_cost_centre FOREIGN KEY (cost_center_id)
      REFERENCES cost_centres(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── Budget Management ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accounting_budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gl_account_id   UUID NOT NULL REFERENCES gl_accounts(id),
  fiscal_year     INTEGER NOT NULL,
  annual_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  jan             NUMERIC(15,2) NOT NULL DEFAULT 0,
  feb             NUMERIC(15,2) NOT NULL DEFAULT 0,
  mar             NUMERIC(15,2) NOT NULL DEFAULT 0,
  apr             NUMERIC(15,2) NOT NULL DEFAULT 0,
  may             NUMERIC(15,2) NOT NULL DEFAULT 0,
  jun             NUMERIC(15,2) NOT NULL DEFAULT 0,
  jul             NUMERIC(15,2) NOT NULL DEFAULT 0,
  aug             NUMERIC(15,2) NOT NULL DEFAULT 0,
  sep             NUMERIC(15,2) NOT NULL DEFAULT 0,
  oct             NUMERIC(15,2) NOT NULL DEFAULT 0,
  nov             NUMERIC(15,2) NOT NULL DEFAULT 0,
  "dec"           NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(gl_account_id, fiscal_year)
);

CREATE INDEX idx_budgets_year ON accounting_budgets(fiscal_year);

-- ── DRC VAT ─────────────────────────────────────────────────────────────────

ALTER TABLE supplier_invoices ADD COLUMN IF NOT EXISTS is_drc BOOLEAN DEFAULT false;

-- ── Triggers ────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_cost_centres_updated BEFORE UPDATE ON cost_centres
  FOR EACH ROW EXECUTE FUNCTION accounting_updated_at();

CREATE TRIGGER trg_budgets_updated BEFORE UPDATE ON accounting_budgets
  FOR EACH ROW EXECUTE FUNCTION accounting_updated_at();
