-- Migration: 092_offline_devices_summary_fields
-- Description: Add additional fields from network summary report
-- Date: 2026-01-19
-- Purpose:
--   - Support richer data from law_daily_network_summary_report
--   - Add Zone, PON, Address, Pole, Installation Date, Days Since Activation, Revenue

-- =============================================================================
-- ADD COLUMNS TO offline_devices TABLE
-- =============================================================================

-- Zone/location fields
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS zone VARCHAR(50);
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS planned_pon VARCHAR(50);
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS pole_number VARCHAR(50);
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS point_of_interest VARCHAR(100);

-- Installation tracking
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS installation_date DATE;
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS days_since_activation INT;

-- Revenue data
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS revenue_30day_avg DECIMAL(10,2);

-- Source tracking
ALTER TABLE offline_devices ADD COLUMN IF NOT EXISTS source_report VARCHAR(20) DEFAULT 'audit';
-- 'audit' = law_daily_network_audit_detail_report (old format)
-- 'summary' = law_daily_network_summary_report (new format with more fields)

-- =============================================================================
-- INDEXES FOR NEW COLUMNS
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_offline_devices_zone ON offline_devices(zone);
CREATE INDEX IF NOT EXISTS idx_offline_devices_pon ON offline_devices(planned_pon);
CREATE INDEX IF NOT EXISTS idx_offline_devices_pole ON offline_devices(pole_number);
CREATE INDEX IF NOT EXISTS idx_offline_devices_install_date ON offline_devices(installation_date);

-- =============================================================================
-- UPDATE VIEWS
-- =============================================================================

-- Update current offline view to include new fields
CREATE OR REPLACE VIEW v_current_offline_devices AS
SELECT DISTINCT ON (od.drop_number)
  od.*,
  d.address AS drop_address,
  d.zone AS drop_zone,
  d.pon AS drop_pon,
  oes.team,
  oes.activation_date
FROM offline_devices od
LEFT JOIN drops d ON od.drop_id = d.id
LEFT JOIN oes_activations oes ON od.drop_number = oes.drop_number
ORDER BY od.drop_number, od.report_date DESC;

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN offline_devices.zone IS 'Zone from summary report (e.g., Zone 1, Zone 7)';
COMMENT ON COLUMN offline_devices.planned_pon IS 'Planned PON from summary report';
COMMENT ON COLUMN offline_devices.address IS 'Full address from summary report';
COMMENT ON COLUMN offline_devices.pole_number IS 'Pole reference (e.g., LAW.P.A013)';
COMMENT ON COLUMN offline_devices.point_of_interest IS 'Nearby landmark';
COMMENT ON COLUMN offline_devices.installation_date IS 'Date device was installed';
COMMENT ON COLUMN offline_devices.days_since_activation IS 'Days since initial activation';
COMMENT ON COLUMN offline_devices.revenue_30day_avg IS '30-day revenue average';
COMMENT ON COLUMN offline_devices.source_report IS 'audit or summary - indicates which report format';
