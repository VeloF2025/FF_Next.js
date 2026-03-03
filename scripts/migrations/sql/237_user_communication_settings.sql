-- Migration 237: User communication settings
-- Global preferences for quiet hours, digest frequency, email signature

CREATE TABLE IF NOT EXISTS user_communication_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '07:00',
  digest_frequency VARCHAR(20) NOT NULL DEFAULT 'immediate'
    CHECK (digest_frequency IN ('immediate', 'hourly', 'daily')),
  email_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);
