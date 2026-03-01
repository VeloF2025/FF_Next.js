-- Migration 225: Internal Messaging
-- Staff-to-staff threaded messages with multi-recipient support
-- Part of Communications Hub Phase 3

CREATE TABLE IF NOT EXISTS internal_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id),
  subject VARCHAR(500),
  body TEXT NOT NULL,
  priority VARCHAR(20) DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  thread_id UUID REFERENCES internal_messages(id),
  context_module VARCHAR(50),
  context_id UUID,
  context_url VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS internal_message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES internal_messages(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES users(id),
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  is_archived BOOLEAN DEFAULT FALSE,
  UNIQUE (message_id, recipient_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_internal_messages_sender ON internal_messages(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_messages_thread ON internal_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_internal_msg_recipients_user ON internal_message_recipients(recipient_id, is_read, is_archived);
CREATE INDEX IF NOT EXISTS idx_internal_msg_recipients_message ON internal_message_recipients(message_id);
