-- Migration: QField Photo AI Validation System
-- Created: 2026-02-07
-- Description: Stores VLM validation results for photos synced from QField
--              and per-project validation configuration settings

-- ============================================================================
-- TABLE: qfield_photo_validations
-- ============================================================================
-- Stores VLM validation results for QField photos with retake tracking
CREATE TABLE IF NOT EXISTS qfield_photo_validations (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Photo Identification
  photo_key TEXT NOT NULL,           -- MinIO path (e.g., projects/xxx/DCIM/IMG_001.jpg)
  feature_id TEXT,                   -- Linked pole/DR/splice ID from QField
  feature_type TEXT,                 -- 'pole', 'drop', 'splice', 'cable'
  work_type TEXT,                    -- 'pole_installation', 'cable_stringing', 'dome_joint', 'activation'
  project_id UUID,                   -- QFieldCloud project ID

  -- VLM Validation Results
  vlm_confidence DECIMAL(3,2),       -- 0.00 to 1.00
  vlm_feedback TEXT,                 -- Human-readable feedback for technician
  vlm_raw_response JSONB,            -- Full VLM response for debugging/analysis

  -- Retake Status Tracking
  needs_retake BOOLEAN DEFAULT FALSE,
  retake_notified_at TIMESTAMPTZ,    -- When WhatsApp notification sent to technician
  retake_completed_at TIMESTAMPTZ,   -- When replacement photo was synced

  -- Timestamps
  validated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_confidence CHECK (vlm_confidence >= 0 AND vlm_confidence <= 1),
  CONSTRAINT valid_feature_type CHECK (feature_type IN ('pole', 'drop', 'splice', 'cable', NULL)),
  CONSTRAINT valid_work_type CHECK (work_type IN ('pole_installation', 'cable_stringing', 'dome_joint', 'activation', NULL))
);

-- Indexes for qfield_photo_validations
CREATE INDEX IF NOT EXISTS idx_qfield_validations_photo_key
  ON qfield_photo_validations(photo_key);

CREATE INDEX IF NOT EXISTS idx_qfield_validations_needs_retake
  ON qfield_photo_validations(needs_retake)
  WHERE needs_retake = TRUE;

CREATE INDEX IF NOT EXISTS idx_qfield_validations_project
  ON qfield_photo_validations(project_id);

CREATE INDEX IF NOT EXISTS idx_qfield_validations_feature
  ON qfield_photo_validations(feature_id, feature_type);

CREATE INDEX IF NOT EXISTS idx_qfield_validations_validated_at
  ON qfield_photo_validations(validated_at DESC);

-- Composite index for retake notification queries
CREATE INDEX IF NOT EXISTS idx_qfield_validations_retake_pending
  ON qfield_photo_validations(needs_retake, retake_notified_at)
  WHERE needs_retake = TRUE AND retake_notified_at IS NULL;

-- ============================================================================
-- TABLE: qfield_validation_config
-- ============================================================================
-- Per-project validation settings and notification configuration
CREATE TABLE IF NOT EXISTS qfield_validation_config (
  -- Primary Key
  project_id UUID PRIMARY KEY,

  -- Validation Settings
  validation_enabled BOOLEAN DEFAULT FALSE,
  confidence_threshold DECIMAL(3,2) DEFAULT 0.60,

  -- Notification Settings
  notify_on_failure BOOLEAN DEFAULT TRUE,
  notification_group_jid TEXT,       -- WhatsApp group JID for failure notifications

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_threshold CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1)
);

-- Index for active projects lookup
CREATE INDEX IF NOT EXISTS idx_qfield_validation_config_enabled
  ON qfield_validation_config(validation_enabled)
  WHERE validation_enabled = TRUE;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE qfield_photo_validations IS
  'Stores VLM validation results for photos synced from QField with retake tracking';

COMMENT ON COLUMN qfield_photo_validations.photo_key IS
  'MinIO object path (e.g., projects/abc123/DCIM/IMG_20260207_001.jpg)';

COMMENT ON COLUMN qfield_photo_validations.vlm_confidence IS
  'VLM confidence score between 0.00 (poor) and 1.00 (excellent)';

COMMENT ON COLUMN qfield_photo_validations.vlm_feedback IS
  'Human-readable feedback message shown to technician';

COMMENT ON COLUMN qfield_photo_validations.vlm_raw_response IS
  'Complete VLM API response stored as JSON for debugging';

COMMENT ON COLUMN qfield_photo_validations.needs_retake IS
  'TRUE when confidence falls below project threshold';

COMMENT ON TABLE qfield_validation_config IS
  'Per-project configuration for QField photo validation and notifications';

COMMENT ON COLUMN qfield_validation_config.confidence_threshold IS
  'Minimum VLM confidence required (default 0.60 = 60%)';

COMMENT ON COLUMN qfield_validation_config.notification_group_jid IS
  'WhatsApp group JID for sending retake notifications (format: 120363XXXXX@g.us)';

-- ============================================================================
-- SAMPLE DATA (commented out for production)
-- ============================================================================
-- Insert default config for testing
-- INSERT INTO qfield_validation_config (project_id, validation_enabled, confidence_threshold, notify_on_failure)
-- VALUES
--   ('550e8400-e29b-41d4-a716-446655440000', TRUE, 0.65, TRUE)
-- ON CONFLICT (project_id) DO NOTHING;
