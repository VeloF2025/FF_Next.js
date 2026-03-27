-- Migration 235: H&S Corrective & Preventive Actions (CAPA)
--
-- CAPA is the backbone of the H&S system — used by incidents, audits,
-- permits, and risk assessments. Status workflow:
--   open → in_progress → verification → closed (or overdue)

BEGIN;

-- CAPA records
CREATE TABLE IF NOT EXISTS hs_corrective_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source tracking
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('audit', 'incident', 'observation', 'risk', 'permit')),
  source_id UUID,                        -- ID of the source record

  -- Context
  project_id UUID REFERENCES projects(id),
  contractor_id UUID REFERENCES contractors(id),

  -- Details
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- Workflow
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'verification', 'closed', 'overdue')),
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  due_date DATE NOT NULL,

  -- Completion
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  completion_notes TEXT,

  -- Verification (close-the-loop)
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  verification_notes TEXT,
  verification_outcome VARCHAR(20) CHECK (verification_outcome IN ('accepted', 'rejected', 'rework_needed')),

  -- Root cause analysis
  root_cause_method VARCHAR(20) CHECK (root_cause_method IN ('five_whys', 'fishbone', 'fault_tree', 'other')),
  root_cause_analysis JSONB DEFAULT '[]'::jsonb,

  -- Preventive measures
  preventive_actions TEXT,

  -- Evidence
  evidence_photos JSONB DEFAULT '[]'::jsonb,

  -- Audit trail
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CAPA comments / activity
CREATE TABLE IF NOT EXISTS hs_capa_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_id UUID NOT NULL REFERENCES hs_corrective_actions(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id),
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hs_capa_project ON hs_corrective_actions(project_id);
CREATE INDEX IF NOT EXISTS idx_hs_capa_contractor ON hs_corrective_actions(contractor_id);
CREATE INDEX IF NOT EXISTS idx_hs_capa_status ON hs_corrective_actions(status);
CREATE INDEX IF NOT EXISTS idx_hs_capa_source ON hs_corrective_actions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_hs_capa_due_date ON hs_corrective_actions(due_date) WHERE status NOT IN ('closed');
CREATE INDEX IF NOT EXISTS idx_hs_capa_assigned ON hs_corrective_actions(assigned_to) WHERE status NOT IN ('closed');
CREATE INDEX IF NOT EXISTS idx_hs_capa_comments_capa ON hs_capa_comments(capa_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_hs_capa_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hs_capa_updated_at ON hs_corrective_actions;
CREATE TRIGGER trg_hs_capa_updated_at
  BEFORE UPDATE ON hs_corrective_actions
  FOR EACH ROW EXECUTE FUNCTION update_hs_capa_updated_at();

COMMIT;
