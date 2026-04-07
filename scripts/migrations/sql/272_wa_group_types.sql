-- Migration: 272_wa_group_types.sql
-- Description: Add group_type to wa_group_config so projects can have
--              separate WhatsApp groups for different purposes (dr_photos, snags, etc.)

-- 1. Add group_type column (default 'dr_photos' for existing rows)
ALTER TABLE wa_group_config
  ADD COLUMN IF NOT EXISTS group_type VARCHAR(50) NOT NULL DEFAULT 'dr_photos';

-- 2. Drop the old unique constraint on project_name alone
ALTER TABLE wa_group_config
  DROP CONSTRAINT IF EXISTS wa_group_config_project_name_key;

-- 3. Add new composite unique constraint
ALTER TABLE wa_group_config
  ADD CONSTRAINT wa_group_config_project_type_unique UNIQUE (project_name, group_type);

-- 4. Index for type-specific lookups
CREATE INDEX IF NOT EXISTS idx_wa_group_config_type
  ON wa_group_config(group_type) WHERE enabled = true;

-- 5. Comment
COMMENT ON COLUMN wa_group_config.group_type IS 'Group purpose: dr_photos, snags, maintenance, etc.';
