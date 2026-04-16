-- Migration 304: project_team_assignments junction table
--
-- Links projects to teams with a role label.
-- Used to auto-assign the correct activations team when creating tickets.
-- roles: activations, maintenance, fault_repair, other
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS project_team_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'activations'
                CHECK (role IN ('activations', 'maintenance', 'fault_repair', 'other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, team_id, role)
);

CREATE INDEX IF NOT EXISTS idx_pta_project ON project_team_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_pta_team ON project_team_assignments(team_id);
CREATE INDEX IF NOT EXISTS idx_pta_project_role ON project_team_assignments(project_id, role);
