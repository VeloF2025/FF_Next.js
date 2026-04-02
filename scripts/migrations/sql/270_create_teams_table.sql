-- Migration 270: Create teams table for NOC / maintenance team management
--
-- Problem: The NOC module references a `teams` table (teamService.ts, notificationTriggers.ts)
-- but no migration ever created it. Migration 223 prepared team_members to work with both
-- contractor_teams and a `teams` table, but the table itself was never added.
-- This causes team-based ticket notifications to silently fail.

-- 1. Create the teams table
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  team_type VARCHAR(50) NOT NULL DEFAULT 'internal'
    CHECK (team_type IN ('internal', 'contractor', 'field', 'support', 'maintenance', 'installation')),
  lead_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_teams_team_type ON teams(team_type);
CREATE INDEX IF NOT EXISTS idx_teams_is_active ON teams(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_teams_lead_user ON teams(lead_user_id) WHERE lead_user_id IS NOT NULL;

-- 3. Add user_id column to team_members for internal staff (if not already present)
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id) WHERE user_id IS NOT NULL;

-- 4. Add updated_at to team_members if missing
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
