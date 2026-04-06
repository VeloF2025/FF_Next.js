-- Migration: Create site_visits table for IMS Phase B - Feature 3
-- Date: 2026-04-06
-- Description: Site visit scheduling and reports for contractors/projects

CREATE TYPE site_visit_type AS ENUM ('inspection', 'progress_check', 'handover', 'safety_audit');
CREATE TYPE site_visit_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

CREATE TABLE IF NOT EXISTS site_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,

  -- Schedule
  scheduled_date DATE NOT NULL,
  actual_date DATE,

  -- Classification
  visit_type site_visit_type NOT NULL DEFAULT 'inspection',
  status site_visit_status NOT NULL DEFAULT 'scheduled',

  -- Inspector
  inspector_name TEXT NOT NULL,
  inspector_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Content
  notes TEXT,
  findings TEXT,
  action_items TEXT[],
  attachments TEXT[],

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_site_visits_project_id ON site_visits(project_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_contractor_id ON site_visits(contractor_id);
CREATE INDEX IF NOT EXISTS idx_site_visits_scheduled_date ON site_visits(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_site_visits_status ON site_visits(status);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_site_visits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER site_visits_updated_at
  BEFORE UPDATE ON site_visits
  FOR EACH ROW
  EXECUTE FUNCTION update_site_visits_updated_at();

-- Comments for documentation
COMMENT ON TABLE site_visits IS 'Scheduled and completed site visits for projects and contractors';
COMMENT ON COLUMN site_visits.visit_type IS 'inspection | progress_check | handover | safety_audit';
COMMENT ON COLUMN site_visits.status IS 'scheduled | completed | cancelled | no_show';
COMMENT ON COLUMN site_visits.action_items IS 'Array of action items identified during the visit';
COMMENT ON COLUMN site_visits.attachments IS 'Array of file paths or URLs for visit attachments';
