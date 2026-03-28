-- Migration 237: H&S Risk Register & Hazard Identification
--
-- 5x5 risk matrix (likelihood x severity) per SA Construction Regs.
-- Tracks inherent risk, existing controls, and residual risk.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_risk_register (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),

  -- Hazard identification
  hazard_description TEXT NOT NULL,
  risk_category VARCHAR(30) NOT NULL CHECK (risk_category IN (
    'physical', 'chemical', 'biological', 'ergonomic', 'environmental',
    'electrical', 'fire', 'working_at_heights', 'fibre_specific', 'vehicle', 'other'
  )),
  site_location TEXT,
  activity_description TEXT,
  persons_at_risk TEXT,

  -- Inherent risk (before controls)
  likelihood INTEGER NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  risk_score INTEGER GENERATED ALWAYS AS (likelihood * severity) STORED,
  risk_level VARCHAR(10) GENERATED ALWAYS AS (
    CASE
      WHEN likelihood * severity >= 20 THEN 'extreme'
      WHEN likelihood * severity >= 12 THEN 'high'
      WHEN likelihood * severity >= 6 THEN 'medium'
      ELSE 'low'
    END
  ) STORED,

  -- Controls
  existing_controls TEXT,

  -- Residual risk (after controls)
  residual_likelihood INTEGER CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_severity INTEGER CHECK (residual_severity BETWEEN 1 AND 5),
  residual_risk_score INTEGER GENERATED ALWAYS AS (
    COALESCE(residual_likelihood, likelihood) * COALESCE(residual_severity, severity)
  ) STORED,
  residual_risk_level VARCHAR(10) GENERATED ALWAYS AS (
    CASE
      WHEN COALESCE(residual_likelihood, likelihood) * COALESCE(residual_severity, severity) >= 20 THEN 'extreme'
      WHEN COALESCE(residual_likelihood, likelihood) * COALESCE(residual_severity, severity) >= 12 THEN 'high'
      WHEN COALESCE(residual_likelihood, likelihood) * COALESCE(residual_severity, severity) >= 6 THEN 'medium'
      ELSE 'low'
    END
  ) STORED,
  additional_controls TEXT,

  -- Management
  responsible_person UUID REFERENCES users(id),
  review_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mitigated', 'closed', 'accepted')),
  regulation_reference TEXT,

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risk review history
CREATE TABLE IF NOT EXISTS hs_risk_register_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  risk_id UUID NOT NULL REFERENCES hs_risk_register(id) ON DELETE CASCADE,
  reviewed_by UUID REFERENCES users(id),
  review_date DATE NOT NULL DEFAULT CURRENT_DATE,
  previous_risk_score INTEGER,
  new_risk_score INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hs_risk_project ON hs_risk_register(project_id);
CREATE INDEX IF NOT EXISTS idx_hs_risk_category ON hs_risk_register(risk_category);
CREATE INDEX IF NOT EXISTS idx_hs_risk_level ON hs_risk_register(risk_level) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_hs_risk_review ON hs_risk_register(review_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_hs_risk_reviews_risk ON hs_risk_register_reviews(risk_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_hs_risk_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hs_risk_updated_at ON hs_risk_register;
CREATE TRIGGER trg_hs_risk_updated_at
  BEFORE UPDATE ON hs_risk_register
  FOR EACH ROW EXECUTE FUNCTION update_hs_risk_updated_at();

COMMIT;
