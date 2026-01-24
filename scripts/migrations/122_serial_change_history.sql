-- Migration 122: Serial Change History Table
-- Tracks ALL changes to ONT/UPS serials for complete audit trail
-- Retention: Forever (no automatic deletion)

-- Create serial change history table
CREATE TABLE IF NOT EXISTS serial_change_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DR Reference
  drop_number VARCHAR(50) NOT NULL,

  -- Change Details
  change_type VARCHAR(20) NOT NULL,           -- 'ont_serial' | 'ups_serial'
  old_value VARCHAR(100),                      -- Previous value (NULL for first entry)
  new_value VARCHAR(100),                      -- New value

  -- Source & Context
  change_source VARCHAR(50) NOT NULL,          -- 'onemap_sync' | 'manual_edit' | 'vlm_extraction' | 'wa_photo_vlm' | 'swap_correction' | 'migration'
  change_reason VARCHAR(100),                  -- 'technician_update' | 'swap_correction' | 'replacement' | 'data_fix' | 'initial_capture'

  -- Who/What made the change
  actor VARCHAR(100) NOT NULL DEFAULT 'system', -- user_id, 'system', 'vlm', 'onemap-api', etc.

  -- Metadata for additional context
  metadata JSONB DEFAULT '{}'::jsonb,          -- Flexible: {swap_detected, confidence, related_dr, notes, etc.}

  -- Timestamps
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
-- 1. Get history for a specific DR (primary use case)
CREATE INDEX idx_serial_history_drop ON serial_change_history(drop_number, detected_at DESC);

-- 2. Get recent changes across all DRs
CREATE INDEX idx_serial_history_detected ON serial_change_history(detected_at DESC);

-- 3. Filter by change type
CREATE INDEX idx_serial_history_type ON serial_change_history(change_type);

-- 4. Filter by source
CREATE INDEX idx_serial_history_source ON serial_change_history(change_source);

-- 5. Search by serial value (to find where a serial was used)
CREATE INDEX idx_serial_history_old_value ON serial_change_history(old_value) WHERE old_value IS NOT NULL;
CREATE INDEX idx_serial_history_new_value ON serial_change_history(new_value) WHERE new_value IS NOT NULL;

-- Add comments
COMMENT ON TABLE serial_change_history IS 'Complete audit trail of all ONT/UPS serial changes per DR';
COMMENT ON COLUMN serial_change_history.change_type IS 'Type of serial: ont_serial or ups_serial';
COMMENT ON COLUMN serial_change_history.change_source IS 'Where the change originated from';
COMMENT ON COLUMN serial_change_history.change_reason IS 'Why the change was made (optional)';
COMMENT ON COLUMN serial_change_history.actor IS 'Who or what triggered the change';
COMMENT ON COLUMN serial_change_history.metadata IS 'Additional context: swap_detected, confidence scores, notes';

-- View for recent changes summary
CREATE OR REPLACE VIEW v_recent_serial_changes AS
SELECT
  sch.drop_number,
  sch.change_type,
  sch.old_value,
  sch.new_value,
  sch.change_source,
  sch.change_reason,
  sch.actor,
  sch.detected_at,
  u.project,
  CASE
    WHEN sch.old_value IS NULL THEN 'initial_capture'
    WHEN sch.old_value = sch.new_value THEN 'no_change'
    ELSE 'updated'
  END as change_classification
FROM serial_change_history sch
LEFT JOIN dr_photo_unified_reviews u ON sch.drop_number = u.drop_number
ORDER BY sch.detected_at DESC;

-- View for serial change statistics
CREATE OR REPLACE VIEW v_serial_change_stats AS
SELECT
  DATE_TRUNC('day', detected_at) as change_date,
  change_type,
  change_source,
  COUNT(*) as change_count,
  COUNT(CASE WHEN old_value IS NULL THEN 1 END) as initial_captures,
  COUNT(CASE WHEN old_value IS NOT NULL AND old_value != new_value THEN 1 END) as actual_changes,
  COUNT(CASE WHEN metadata->>'swap_detected' = 'true' THEN 1 END) as swaps_detected
FROM serial_change_history
GROUP BY DATE_TRUNC('day', detected_at), change_type, change_source
ORDER BY change_date DESC, change_type;
