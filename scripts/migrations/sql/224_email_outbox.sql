-- Migration 224: Email Outbox
-- Tracks all outbound emails sent from FibreFlow (manual compose + UNS-dispatched)
-- Part of Communications Hub Phase 2

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES users(id),
  recipient_email VARCHAR(500) NOT NULL,
  recipient_name VARCHAR(200),
  subject VARCHAR(500) NOT NULL,
  body_html TEXT,
  body_text TEXT,
  source_module VARCHAR(50) DEFAULT 'manual',
  source_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sending','sent','delivered','failed','bounced')),
  resend_id VARCHAR(200),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_email_outbox_sender ON email_outbox(sender_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_source ON email_outbox(source_module, source_id);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox(created_at DESC);
