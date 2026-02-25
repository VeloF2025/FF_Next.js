-- Migration 208: Phase 2 Banking Intelligence
-- Quick entry rules and statement mapping for auto-categorisation

CREATE TABLE IF NOT EXISTS bank_categorisation_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name       TEXT NOT NULL,
  match_field     TEXT NOT NULL CHECK (match_field IN ('description', 'reference', 'both')),
  match_type      TEXT NOT NULL CHECK (match_type IN ('contains', 'starts_with', 'ends_with', 'exact')),
  match_pattern   TEXT NOT NULL,
  gl_account_id   UUID NOT NULL REFERENCES gl_accounts(id),
  supplier_id     INTEGER REFERENCES suppliers(id),
  description_template TEXT,
  priority        INTEGER NOT NULL DEFAULT 100,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  auto_create_entry BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bcr_active ON bank_categorisation_rules(is_active, priority);

-- Trigger
CREATE TRIGGER trg_bank_rules_updated BEFORE UPDATE ON bank_categorisation_rules
  FOR EACH ROW EXECUTE FUNCTION accounting_updated_at();
