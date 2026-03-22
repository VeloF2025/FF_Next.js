-- Migration 252: Add status column to conduit_projects
-- Fixes: all projects appearing in all sections (Prospective/Executable/Actual)
-- Values: 'prospective' | 'executable' | 'actual'
-- Default: 'prospective' (safe — hides from Executable/Actual until explicitly set)

ALTER TABLE conduit_projects
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'prospective'
    CHECK (status IN ('prospective', 'executable', 'actual'));

-- Grabouw is prospective — ensure it is not shown under Executable
UPDATE conduit_projects SET status = 'prospective' WHERE name = 'Grabouw';

-- Lawley is the only live executable project (seeded in migration 249)
UPDATE conduit_projects SET status = 'executable' WHERE name = 'Lawley';
