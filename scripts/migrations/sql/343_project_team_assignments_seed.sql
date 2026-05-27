-- Migration 343: Seed project-team activations assignments for all live projects
-- Fixes: modal auto-select was only working for Lawley; other projects showed
-- "no team configured" and tickets were created without a team name.
-- See also: ticketService.ts patch that mirrors assigned_team_id → assigned_team
-- (both are UUID FK to teams) for callers that only set assigned_team_id.

-- Mamelodi → Mamelodi Activations
INSERT INTO project_team_assignments (project_id, team_id, role)
VALUES ('7003dc06-9af7-4a7c-bc6c-a177d77784f2', '8e1ab592-8a62-430f-bb62-592cd9bc1f40', 'activations')
ON CONFLICT (project_id, team_id, role) DO NOTHING;

-- Mohadin → Mohadin Activations
INSERT INTO project_team_assignments (project_id, team_id, role)
VALUES ('bf9a90db-e758-4c05-b999-694cd63c451f', '48507948-48ba-4d95-9768-e2b40a6d13bb', 'activations')
ON CONFLICT (project_id, team_id, role) DO NOTHING;

-- Thembisa POP 1 → Tembisa Activations
INSERT INTO project_team_assignments (project_id, team_id, role)
VALUES ('7d8b94d6-8e5a-4dbb-9ede-69ce3884e004', '601b3f04-a60f-4d5b-8301-e32885e31256', 'activations')
ON CONFLICT (project_id, team_id, role) DO NOTHING;

-- Thembisa POP 2 → Tembisa Activations
INSERT INTO project_team_assignments (project_id, team_id, role)
VALUES ('d3df9135-9aa3-415d-87b6-17cce547eb22', '601b3f04-a60f-4d5b-8301-e32885e31256', 'activations')
ON CONFLICT (project_id, team_id, role) DO NOTHING;

-- Thembisa POP 3 → Tembisa Activations
INSERT INTO project_team_assignments (project_id, team_id, role)
VALUES ('1de088dd-fe24-43fb-b8d3-94fca61ef91d', '601b3f04-a60f-4d5b-8301-e32885e31256', 'activations')
ON CONFLICT (project_id, team_id, role) DO NOTHING;

-- Backfill: mirror assigned_team_id → assigned_team for tickets where the
-- legacy field was never set. Both columns are UUID FKs to teams; they should
-- always be in sync. Tickets created via the OLT/PP bulk APIs only set
-- assigned_team_id; this patch brings assigned_team into alignment.
UPDATE maintenance_tickets
SET assigned_team = assigned_team_id
WHERE assigned_team IS NULL
  AND assigned_team_id IS NOT NULL;
