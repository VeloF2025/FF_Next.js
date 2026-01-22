-- Migration 112: Staff Notifications Table
-- Tracks sent notifications for birthdays, document expiry, and compliance alerts

-- Staff notifications log table
CREATE TABLE IF NOT EXISTS staff_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50) NOT NULL, -- 'birthday', 'expiry', 'compliance'
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}',
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed', 'pending'
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_staff_notifications_type ON staff_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_staff_notifications_sent_at ON staff_notifications(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_notifications_status ON staff_notifications(status);

-- Add expiry date columns to staff table if they don't exist
DO $$
BEGIN
  -- Medical certificate expiry
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'medical_certificate_expiry'
  ) THEN
    ALTER TABLE staff ADD COLUMN medical_certificate_expiry DATE;
  END IF;

  -- Police clearance expiry
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'police_clearance_expiry'
  ) THEN
    ALTER TABLE staff ADD COLUMN police_clearance_expiry DATE;
  END IF;

  -- Work permit expiry
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'staff' AND column_name = 'work_permit_expiry'
  ) THEN
    ALTER TABLE staff ADD COLUMN work_permit_expiry DATE;
  END IF;
END $$;

-- Comment on table
COMMENT ON TABLE staff_notifications IS 'Tracks sent HR notifications for birthdays, document expiry alerts, and compliance summaries';
