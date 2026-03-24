-- Migration 256: Unified Action Items
-- Renames meeting_action_items → action_items
-- Adds user linking, source tracking, and project context
-- Author: Claude / 2026-03-24

-- Step 1: Drop old seed action_items table (12 test rows, no FKs, no production data)
-- and rename meeting_action_items (1018 rows, real data) to action_items
DROP TABLE IF EXISTS action_items;
ALTER TABLE meeting_action_items RENAME TO action_items;

-- Step 2: Add unified fields
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) DEFAULT 'meeting',
  ADD COLUMN IF NOT EXISTS source_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Step 3: Backfill source_id from meeting_id
UPDATE action_items
SET source_type = 'meeting',
    source_id = meeting_id::text
WHERE meeting_id IS NOT NULL;

-- Step 4: Backfill assigned_to_user_id from assignee_name
UPDATE action_items ai
SET assigned_to_user_id = u.id
FROM users u
WHERE ai.assigned_to_user_id IS NULL
  AND ai.assignee_name IS NOT NULL
  AND (
    LOWER(TRIM(ai.assignee_name)) = LOWER(u.first_name || ' ' || u.last_name)
    OR LOWER(TRIM(ai.assignee_name)) = LOWER(CONCAT(u.first_name, ' ', u.last_name))
    OR LOWER(TRIM(ai.assignee_name)) = LOWER(u.first_name)
    OR LOWER(TRIM(ai.assignee_name)) = LOWER(u.last_name)
  );

-- Step 5: Indexes
CREATE INDEX IF NOT EXISTS idx_action_items_user
  ON action_items(assigned_to_user_id)
  WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_source
  ON action_items(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_action_items_project
  ON action_items(project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_status
  ON action_items(status);
