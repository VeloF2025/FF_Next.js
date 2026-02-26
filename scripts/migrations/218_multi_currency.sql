-- Migration 218: Multi-currency foundation
-- Supports: Currency master, exchange rates, transaction currency tracking

-- ── Currency Master ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS currencies (
  code VARCHAR(3) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  symbol VARCHAR(5) NOT NULL,
  decimal_places INTEGER NOT NULL DEFAULT 2,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed common currencies
INSERT INTO currencies (code, name, symbol) VALUES
  ('ZAR', 'South African Rand', 'R'),
  ('USD', 'US Dollar', '$'),
  ('EUR', 'Euro', '€'),
  ('GBP', 'British Pound', '£')
ON CONFLICT (code) DO NOTHING;

-- ── Exchange Rates ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency VARCHAR(3) NOT NULL REFERENCES currencies(code),
  to_currency VARCHAR(3) NOT NULL REFERENCES currencies(code),
  rate NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  effective_date DATE NOT NULL,
  source VARCHAR(30) DEFAULT 'manual',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(from_currency, to_currency, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_exr_date ON exchange_rates(effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_exr_pair ON exchange_rates(from_currency, to_currency);

-- ── Company Settings (reporting currency) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS accounting_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(50) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO accounting_settings (setting_key, setting_value) VALUES
  ('reporting_currency', 'ZAR'),
  ('tax_rate_default', '15'),
  ('fiscal_year_start_month', '3')
ON CONFLICT (setting_key) DO NOTHING;
