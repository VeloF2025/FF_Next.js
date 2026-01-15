-- Migration: 046_user_sidebar_preferences
-- Description: User customizable sidebar menu items
-- Date: 2026-01-15

-- Create table for user sidebar preferences
CREATE TABLE IF NOT EXISTS user_sidebar_preferences (
  user_id TEXT PRIMARY KEY,
  main_section_items TEXT[] DEFAULT ARRAY['meetings', 'action-items'],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE user_sidebar_preferences IS 'Stores user preferences for customizable sidebar menu items';
COMMENT ON COLUMN user_sidebar_preferences.main_section_items IS 'Array of item IDs to show in MAIN section (max 4, dashboard always pinned)';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_sidebar_preferences_user_id ON user_sidebar_preferences(user_id);
