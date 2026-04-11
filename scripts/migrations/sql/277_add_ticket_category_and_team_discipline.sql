-- Migration 277: Add maintenance_tickets.ticket_category + team discipline/project
--
-- Context: two-axis NOC taxonomy agreed in the April-11 planning session.
--
--   ticket_category   new T1 axis (maintenance / snag / hse_incident /
--                     dev_ops / sales_lead / unspecified). Picked by the
--                     manual form, also set by auto-ingest pipelines (PR 3).
--                     The name is deliberately NOT `category` because
--                     maintenance_tickets already has a `category` column
--                     holding QContact's category hierarchy (Connectivity,
--                     Maintenance, NewInstallation, ...) — that column
--                     stays untouched and continues to serve the QContact
--                     sync inbound path.
--
--   teams.discipline  routing axis for auto-assignment — civils / optical /
--                     activations / maintenance / dev_ops. Matches the
--                     discipline vocabulary that PR 2 adds to ticket_type.
--
--   teams.project_id  per-project team scoping; NULL = global/cross-project.
--
-- Data-preserving — every existing column (including `sub_type`, `category`,
-- `subcategory` from QContact) stays intact. Safe to re-run.
--
-- Related: migrations 270 (teams), 274 (sub_type).

-- ---------------------------------------------------------------------------
-- 1. ticket_category column on maintenance_tickets
-- ---------------------------------------------------------------------------

ALTER TABLE maintenance_tickets
  ADD COLUMN IF NOT EXISTS ticket_category VARCHAR(50);

ALTER TABLE maintenance_tickets DROP CONSTRAINT IF EXISTS maintenance_tickets_ticket_category_check;
ALTER TABLE maintenance_tickets ADD CONSTRAINT maintenance_tickets_ticket_category_check
  CHECK (ticket_category IS NULL OR ticket_category IN (
    'maintenance',
    'snag',
    'hse_incident',
    'dev_ops',
    'sales_lead',
    'unspecified'
  ));

-- Index for dashboard filtering on (type, ticket_category). We keep the
-- pre-existing idx_tickets_type_subtype from migration 274 alone; sub_type
-- stays populated with legacy T2 values.
CREATE INDEX IF NOT EXISTS idx_tickets_type_ticket_category
  ON maintenance_tickets (type, ticket_category);

-- ---------------------------------------------------------------------------
-- 2. Team discipline + project_id
-- ---------------------------------------------------------------------------

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS discipline VARCHAR(20);

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_discipline_check;
ALTER TABLE teams ADD CONSTRAINT teams_discipline_check
  CHECK (discipline IS NULL OR discipline IN (
    'civils', 'optical', 'activations', 'maintenance', 'dev_ops'
  ));

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

-- Partial indexes shaped for the auto-assign query: pick an active team
-- matching a discipline + optionally scoped to the ticket's project.
CREATE INDEX IF NOT EXISTS idx_teams_project_discipline
  ON teams (project_id, discipline)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_teams_discipline
  ON teams (discipline)
  WHERE is_active = true;
