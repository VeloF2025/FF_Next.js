-- Migration 119: Add password reset token support
-- Adds columns for secure password reset flow

-- Add reset token columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;

-- Add password_changed_at for tracking
ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.reset_token IS 'Hashed password reset token';
COMMENT ON COLUMN users.reset_token_expires IS 'Token expiration time (typically 1 hour)';
COMMENT ON COLUMN users.password_changed_at IS 'Last password change timestamp';
