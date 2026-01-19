-- Migration: 091_offline_devices_tracking
-- Description: Track offline devices from daily network audit reports
-- Date: 2026-01-19
-- Purpose:
--   - Import offline device data from Excel reports
--   - Match against drops and oes_activations
--   - Flag serial mismatches
--   - Track historical offline duration
--   - Support QField export

-- =============================================================================
-- IMPORT BATCH TRACKING
-- =============================================================================

CREATE TABLE IF NOT EXISTS offline_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255),
  report_date DATE NOT NULL,
  snapshot_timestamp TIMESTAMPTZ,
  total_rows INTEGER DEFAULT 0,
  matched_drops INTEGER DEFAULT 0,
  matched_oes INTEGER DEFAULT 0,
  unmatched INTEGER DEFAULT 0,
  serial_mismatches INTEGER DEFAULT 0,
  imported_by VARCHAR(100),
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- OFFLINE DEVICES TABLE (with history)
-- =============================================================================

CREATE TABLE IF NOT EXISTS offline_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id UUID REFERENCES offline_import_batches(id) ON DELETE CASCADE,

  -- Core identifiers
  drop_number VARCHAR(20) NOT NULL,
  serial_number VARCHAR(20) NOT NULL,
  area_code VARCHAR(10), -- 'law', 'moh', etc

  -- OLT location
  ont_address VARCHAR(100), -- law.olt.01:1-1-7-3-27
  olt_rack INT,
  olt_shelf INT,
  olt_slot INT,
  olt_port INT,
  olt_ont INT, -- the last number in the address

  -- Offline details
  last_down_reason VARCHAR(100) NOT NULL,
  last_inform_date TIMESTAMPTZ,
  days_since_last_inform INT,
  offline_bucket VARCHAR(50),

  -- Matching status
  drop_id UUID REFERENCES drops(id),
  oes_activation_id UUID,
  match_status VARCHAR(20) DEFAULT 'pending', -- 'matched_drops', 'matched_oes', 'unmatched'

  -- Serial validation
  expected_serial VARCHAR(20), -- from oes_activations
  serial_mismatch BOOLEAN DEFAULT false,
  serial_mismatch_type VARCHAR(50), -- 'different_serial', 'no_oes_record', etc

  -- GPS (from drops or oes_activations)
  latitude DECIMAL(12,8),
  longitude DECIMAL(12,8),

  -- Metadata
  report_date DATE NOT NULL,
  snapshot_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per report date (allows history)
  UNIQUE(drop_number, report_date)
);

-- =============================================================================
-- OFFLINE ALERTS/TICKETS TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS offline_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offline_device_id UUID REFERENCES offline_devices(id) ON DELETE CASCADE,
  drop_number VARCHAR(20) NOT NULL,
  serial_number VARCHAR(20),

  -- Alert details
  alert_type VARCHAR(50) NOT NULL, -- 'long_offline', 'serial_mismatch', 'signal_issue'
  severity VARCHAR(20) DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
  description TEXT,

  -- Context
  days_offline INT,
  last_down_reason VARCHAR(100),

  -- Resolution
  status VARCHAR(20) DEFAULT 'open', -- 'open', 'acknowledged', 'resolved', 'ignored'
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  resolution_notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- UPDATE drops TABLE
-- =============================================================================

-- Add offline tracking columns to drops
ALTER TABLE drops ADD COLUMN IF NOT EXISTS is_offline BOOLEAN DEFAULT false;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS offline_since TIMESTAMPTZ;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS offline_reason VARCHAR(100);
ALTER TABLE drops ADD COLUMN IF NOT EXISTS offline_days INT;
ALTER TABLE drops ADD COLUMN IF NOT EXISTS last_offline_check TIMESTAMPTZ;

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Import batch lookups
CREATE INDEX IF NOT EXISTS idx_offline_import_batch_date ON offline_import_batches(report_date);

-- Offline device lookups
CREATE INDEX IF NOT EXISTS idx_offline_devices_batch ON offline_devices(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_offline_devices_drop ON offline_devices(drop_number);
CREATE INDEX IF NOT EXISTS idx_offline_devices_serial ON offline_devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_offline_devices_date ON offline_devices(report_date);
CREATE INDEX IF NOT EXISTS idx_offline_devices_reason ON offline_devices(last_down_reason);
CREATE INDEX IF NOT EXISTS idx_offline_devices_days ON offline_devices(days_since_last_inform);
CREATE INDEX IF NOT EXISTS idx_offline_devices_mismatch ON offline_devices(serial_mismatch) WHERE serial_mismatch = true;
CREATE INDEX IF NOT EXISTS idx_offline_devices_match_status ON offline_devices(match_status);
CREATE INDEX IF NOT EXISTS idx_offline_devices_drop_id ON offline_devices(drop_id);

-- Alert lookups
CREATE INDEX IF NOT EXISTS idx_offline_alerts_device ON offline_alerts(offline_device_id);
CREATE INDEX IF NOT EXISTS idx_offline_alerts_drop ON offline_alerts(drop_number);
CREATE INDEX IF NOT EXISTS idx_offline_alerts_status ON offline_alerts(status);
CREATE INDEX IF NOT EXISTS idx_offline_alerts_type ON offline_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_offline_alerts_severity ON offline_alerts(severity);

-- Drops offline lookups
CREATE INDEX IF NOT EXISTS idx_drops_is_offline ON drops(is_offline) WHERE is_offline = true;

-- =============================================================================
-- VIEWS FOR REPORTING
-- =============================================================================

-- Current offline status (latest report only)
CREATE OR REPLACE VIEW v_current_offline_devices AS
SELECT DISTINCT ON (od.drop_number)
  od.*,
  d.address,
  d.zone,
  d.pon,
  oes.team,
  oes.activation_date
FROM offline_devices od
LEFT JOIN drops d ON od.drop_id = d.id
LEFT JOIN oes_activations oes ON od.drop_number = oes.drop_number
ORDER BY od.drop_number, od.report_date DESC;

-- Offline duration trends (for a specific drop)
CREATE OR REPLACE VIEW v_offline_history AS
SELECT
  drop_number,
  serial_number,
  report_date,
  days_since_last_inform,
  last_down_reason,
  match_status,
  serial_mismatch
FROM offline_devices
ORDER BY drop_number, report_date;

-- Serial mismatches requiring attention
CREATE OR REPLACE VIEW v_serial_mismatches AS
SELECT
  od.drop_number,
  od.serial_number AS reported_serial,
  od.expected_serial AS oes_serial,
  od.serial_mismatch_type,
  od.days_since_last_inform,
  od.last_down_reason,
  od.report_date,
  d.address,
  oes.team
FROM offline_devices od
LEFT JOIN drops d ON od.drop_id = d.id
LEFT JOIN oes_activations oes ON od.drop_number = oes.drop_number
WHERE od.serial_mismatch = true
ORDER BY od.report_date DESC, od.drop_number;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE offline_import_batches IS 'Tracks each import of offline device Excel reports';
COMMENT ON TABLE offline_devices IS 'Historical record of offline devices from daily reports';
COMMENT ON TABLE offline_alerts IS 'Alerts/tickets for offline issues requiring attention';

COMMENT ON COLUMN offline_devices.match_status IS 'matched_drops, matched_oes, unmatched';
COMMENT ON COLUMN offline_devices.serial_mismatch IS 'True if serial differs from OES activation record';
COMMENT ON COLUMN offline_devices.offline_bucket IS 'Less than 20 days, 20-40 days, etc';

COMMENT ON COLUMN drops.is_offline IS 'Current offline status from latest import';
COMMENT ON COLUMN drops.offline_since IS 'When device first went offline';
COMMENT ON COLUMN drops.offline_reason IS 'Most recent down reason';
