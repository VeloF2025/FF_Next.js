-- Migration 268: Fleet Vehicle Project Assignments
-- Allows vehicles to be assigned to projects with date ranges for mileage reporting

CREATE TABLE IF NOT EXISTS fleet_vehicle_project_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  returned_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fvpa_vehicle_id ON fleet_vehicle_project_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fvpa_project_id ON fleet_vehicle_project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_fvpa_active ON fleet_vehicle_project_assignments(is_active) WHERE is_active = true;

-- Track migration
INSERT INTO migrations (version, name, success)
VALUES ('268', 'fleet_vehicle_project_assignments', true)
ON CONFLICT (version) DO NOTHING;
