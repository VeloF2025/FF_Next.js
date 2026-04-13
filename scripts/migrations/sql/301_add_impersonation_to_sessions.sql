-- Migration 301: Add impersonation tracking to user_sessions
-- Allows sessions created by admin impersonation to be flagged and attributed
-- Created: 2026-04-13

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS is_impersonation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for looking up active impersonation sessions by admin
CREATE INDEX IF NOT EXISTS idx_user_sessions_impersonated_by
  ON user_sessions(impersonated_by)
  WHERE is_impersonation = TRUE;
