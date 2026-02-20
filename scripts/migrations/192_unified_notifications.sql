-- Migration 192: Unified Notification Service (UNS)
-- Creates tables for in-app notifications, user preferences, and delivery audit log

BEGIN;

-- =============================================================================
-- 1. user_notifications - In-app notification store for bell icon
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  title VARCHAR(500) NOT NULL,
  body TEXT,
  icon VARCHAR(50) DEFAULT 'bell',
  severity VARCHAR(20) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'error', 'success')),
  action_url VARCHAR(1000),
  source_module VARCHAR(50),
  source_id UUID,
  metadata JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for unread notifications (bell badge count + dropdown)
CREATE INDEX idx_user_notifications_unread
  ON user_notifications (user_id, is_read, created_at DESC)
  WHERE is_read = FALSE;

-- Index for notification list (all notifications, newest first)
CREATE INDEX idx_user_notifications_list
  ON user_notifications (user_id, created_at DESC);

-- Index for source lookups (e.g., find all notifications for a ticket)
CREATE INDEX idx_user_notifications_source
  ON user_notifications (source_module, source_id)
  WHERE source_id IS NOT NULL;

-- =============================================================================
-- 2. notification_preferences - Per-user per-event channel toggles
-- =============================================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  channel_in_app BOOLEAN NOT NULL DEFAULT TRUE,
  channel_email BOOLEAN NOT NULL DEFAULT FALSE,
  channel_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, event_type)
);

-- =============================================================================
-- 3. notification_delivery_log - Audit trail for email/WA delivery
-- =============================================================================
CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES user_notifications(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'whatsapp', 'in_app')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('sent', 'delivered', 'failed', 'skipped')),
  recipient_address VARCHAR(500),
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for delivery log queries by notification
CREATE INDEX idx_notification_delivery_log_notification
  ON notification_delivery_log (notification_id)
  WHERE notification_id IS NOT NULL;

-- Index for delivery log queries by user
CREATE INDEX idx_notification_delivery_log_user
  ON notification_delivery_log (user_id, created_at DESC);

COMMIT;
