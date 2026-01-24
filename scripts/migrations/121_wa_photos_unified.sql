-- Migration 121: WhatsApp Photos for DR Submissions
-- Creates unified wa_photos table for all WhatsApp-submitted photos (activation + maintenance)
-- This enables capturing serial sticker photos sent via WhatsApp alongside DR numbers

-- Create the unified wa_photos table
CREATE TABLE IF NOT EXISTS wa_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WhatsApp message reference
  wa_message_id VARCHAR(100) NOT NULL,
  wa_group_jid VARCHAR(100) NOT NULL,
  sender_jid VARCHAR(100),
  sender_name VARCHAR(200),
  message_timestamp TIMESTAMPTZ NOT NULL,

  -- DR association
  drop_number VARCHAR(20) NOT NULL,
  project VARCHAR(100),

  -- Photo metadata
  original_filename VARCHAR(255),
  mime_type VARCHAR(100) DEFAULT 'image/jpeg',
  file_size_bytes INTEGER,
  local_path TEXT,  -- /home/louis/whatsapp-bridge-go/store/{group_jid}/{filename}

  -- Purpose: 'activation' (serial photos) | 'maintenance' | 'general'
  purpose VARCHAR(50) DEFAULT 'activation',
  photo_index INTEGER DEFAULT 1,  -- For multiple photos in same message

  -- VLM processing (optional - for serial extraction)
  vlm_processed BOOLEAN DEFAULT false,
  vlm_ont_serial VARCHAR(100),
  vlm_ups_serial VARCHAR(100),
  vlm_confidence DECIMAL(4,3),
  vlm_processed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_wa_photos_drop ON wa_photos(drop_number);
CREATE INDEX IF NOT EXISTS idx_wa_photos_group ON wa_photos(wa_group_jid);
CREATE INDEX IF NOT EXISTS idx_wa_photos_purpose ON wa_photos(purpose);
CREATE INDEX IF NOT EXISTS idx_wa_photos_timestamp ON wa_photos(message_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wa_photos_vlm ON wa_photos(vlm_processed) WHERE vlm_processed = false;

-- Add WA photo tracking columns to dr_photo_unified_reviews
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS wa_photo_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS wa_photo_received_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS wa_serial_photo_warning_sent BOOLEAN DEFAULT false;

-- Function to update wa_photo_count when photos are added
CREATE OR REPLACE FUNCTION update_wa_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the count in dr_photo_unified_reviews
  UPDATE dr_photo_unified_reviews
  SET
    wa_photo_count = (
      SELECT COUNT(*) FROM wa_photos
      WHERE drop_number = NEW.drop_number AND purpose = 'activation'
    ),
    wa_photo_received_at = COALESCE(wa_photo_received_at, NOW()),
    updated_at = NOW()
  WHERE drop_number = NEW.drop_number;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update count when WA photo is added
DROP TRIGGER IF EXISTS trg_update_wa_photo_count ON wa_photos;
CREATE TRIGGER trg_update_wa_photo_count
AFTER INSERT ON wa_photos
FOR EACH ROW
WHEN (NEW.purpose = 'activation')
EXECUTE FUNCTION update_wa_photo_count();

-- Comments for documentation
COMMENT ON TABLE wa_photos IS 'Unified table for all WhatsApp-submitted photos (activation serial photos, maintenance evidence, etc.)';
COMMENT ON COLUMN wa_photos.purpose IS 'activation = serial sticker photos, maintenance = maintenance evidence, general = other';
COMMENT ON COLUMN wa_photos.local_path IS 'Path on Velocity server: /home/louis/whatsapp-bridge-go/store/{group_jid}/{filename}';
COMMENT ON COLUMN wa_photos.vlm_ont_serial IS 'ONT serial extracted by VLM (starts with ALCL/ALCB)';
COMMENT ON COLUMN wa_photos.vlm_ups_serial IS 'UPS serial extracted by VLM (starts with GU18W)';
