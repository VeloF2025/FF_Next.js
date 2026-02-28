-- Migration 223: Allow team_members to support maintenance teams (not just contractor_teams)
--
-- Problem: team_members.team_id has FK to contractor_teams(id) and contractor_id is NOT NULL.
-- The new maintenance "teams" table needs to reuse team_members for its member management,
-- but internal staff don't have a contractor_id and teams.id != contractor_teams.id.
--
-- Fix:
-- 1. Drop FK constraint on team_id → contractor_teams(id) (allow referencing either table)
-- 2. Make contractor_id nullable (internal staff have no contractor)
-- 3. Make role nullable (optional for maintenance teams)

-- 1. Drop the FK constraint on team_id
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_team_id_contractor_teams_id_fk;

-- 2. Make contractor_id nullable
ALTER TABLE team_members ALTER COLUMN contractor_id DROP NOT NULL;

-- 3. Make role nullable
ALTER TABLE team_members ALTER COLUMN role DROP NOT NULL;
