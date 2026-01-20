-- Migration: 093_fleet_calibration_audit.sql
-- Description: Fleet Vehicle Calibration and Audit Trail System
-- Created: 2026-01-20
-- Purpose:
--   1. First-time vehicle calibration (baseline readings + reference photo)
--   2. Audit trail for overrides and verifications

-- ============================================================================
-- 1. Vehicle Calibration Table
-- ============================================================================
-- Stores first-time setup data for each vehicle:
-- - Baseline odometer and fuel level
-- - Dashboard reference photo for VLM few-shot learning
-- - Calibration metadata

CREATE TABLE IF NOT EXISTS fleet_vehicle_calibration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Who and when
    calibrated_at TIMESTAMPTZ DEFAULT NOW(),
    calibrated_by UUID REFERENCES staff(id), -- Driver/staff who did calibration
    calibrated_by_name VARCHAR(100), -- Denormalized for quick display

    -- Baseline readings (manually entered by driver)
    baseline_odometer INTEGER NOT NULL CHECK (baseline_odometer >= 0),
    baseline_fuel_level INTEGER NOT NULL CHECK (baseline_fuel_level >= 0 AND baseline_fuel_level <= 100),

    -- Reference photos for VLM few-shot learning
    dashboard_photo_url TEXT, -- Full dashboard photo with odometer visible
    dashboard_photo_path TEXT, -- Local storage path (for VF Storage Service)

    -- VLM learning metadata
    odometer_region JSONB, -- {x, y, width, height} - detected odometer location
    fuel_gauge_region JSONB, -- {x, y, width, height} - detected fuel gauge location
    vlm_learning_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'trained', 'failed'
    vlm_learning_notes TEXT, -- Any notes from VLM training

    -- Status
    is_active BOOLEAN DEFAULT true, -- Only one active calibration per vehicle
    superseded_by UUID REFERENCES fleet_vehicle_calibration(id), -- If re-calibrated
    superseded_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT unique_active_calibration UNIQUE (vehicle_id, is_active)
);

-- Partial unique index to ensure only one active calibration per vehicle
CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_calibration_active
    ON fleet_vehicle_calibration(vehicle_id)
    WHERE is_active = true;

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_fleet_calibration_vehicle ON fleet_vehicle_calibration(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_calibration_date ON fleet_vehicle_calibration(calibrated_at DESC);

COMMENT ON TABLE fleet_vehicle_calibration IS 'First-time vehicle calibration with baseline readings and VLM reference photos';
COMMENT ON COLUMN fleet_vehicle_calibration.baseline_odometer IS 'Manually entered odometer reading at calibration time';
COMMENT ON COLUMN fleet_vehicle_calibration.baseline_fuel_level IS 'Manually selected fuel level 0-100 in 10% increments';
COMMENT ON COLUMN fleet_vehicle_calibration.dashboard_photo_url IS 'Reference photo URL for VLM few-shot learning';
COMMENT ON COLUMN fleet_vehicle_calibration.odometer_region IS 'Detected/annotated region of odometer in reference photo';

-- ============================================================================
-- 2. Fleet Audit Log Table
-- ============================================================================
-- Comprehensive audit trail for all fleet check-in events:
-- - Odometer overrides (with verification photos)
-- - Calibration events
-- - Anomaly detections and resolutions
-- - Manual interventions

CREATE TABLE IF NOT EXISTS fleet_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Entity references
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    record_id UUID REFERENCES fleet_check_records(id) ON DELETE SET NULL,
    photo_id UUID REFERENCES fleet_check_photos(id) ON DELETE SET NULL,
    calibration_id UUID REFERENCES fleet_vehicle_calibration(id) ON DELETE SET NULL,

    -- Event classification
    event_type VARCHAR(50) NOT NULL, -- See event types below
    event_category VARCHAR(30) NOT NULL, -- 'calibration', 'override', 'anomaly', 'system'
    severity VARCHAR(10) DEFAULT 'info', -- 'info', 'warning', 'error', 'critical'

    -- Event data (flexible JSON storage)
    event_data JSONB NOT NULL DEFAULT '{}',
    -- Examples:
    -- For odometer_override: { original_vlm: 12345, override_value: 12445, reason: "digit confusion", photo_url: "..." }
    -- For calibration: { odometer: 50000, fuel_level: 70, photo_url: "..." }
    -- For anomaly: { expected_max: 500, actual: 1500, action: "flagged" }

    -- Actor information
    performed_by UUID REFERENCES staff(id),
    performed_by_name VARCHAR(100), -- Denormalized

    -- Optional verification evidence
    verification_photo_url TEXT,
    verification_notes TEXT,

    -- Timestamps
    performed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_fleet_audit_vehicle ON fleet_audit_log(vehicle_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_record ON fleet_audit_log(record_id) WHERE record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_audit_type ON fleet_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_category ON fleet_audit_log(event_category);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_date ON fleet_audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_audit_severity ON fleet_audit_log(severity) WHERE severity IN ('warning', 'error', 'critical');

COMMENT ON TABLE fleet_audit_log IS 'Comprehensive audit trail for fleet check-in events';

-- ============================================================================
-- Event Type Reference (documented in comments)
-- ============================================================================
--
-- Calibration Events (category: 'calibration'):
--   - vehicle_calibrated: First-time calibration completed
--   - calibration_updated: Calibration re-done (supersedes previous)
--   - vlm_training_complete: VLM learned from reference photo
--   - vlm_training_failed: VLM training failed
--
-- Override Events (category: 'override'):
--   - odometer_override: Manual override of VLM-extracted odometer
--   - fuel_override: Manual override of VLM-extracted fuel level
--   - verified_override: Override with verification photo taken
--
-- Anomaly Events (category: 'anomaly'):
--   - odometer_anomaly_detected: Unusual km increase detected
--   - odometer_anomaly_resolved: Anomaly explained/resolved
--   - digit_confusion_detected: VLM digit confusion flagged
--   - reading_rejected: VLM reading rejected by validation
--
-- System Events (category: 'system'):
--   - check_in_completed: Check-in successfully submitted
--   - photo_uploaded: Photo uploaded to storage
--   - vlm_extraction_complete: VLM extraction finished
--   - vlm_extraction_failed: VLM extraction error

-- ============================================================================
-- 3. Add calibration status to fleet_check_records
-- ============================================================================

ALTER TABLE fleet_check_records
    ADD COLUMN IF NOT EXISTS is_calibration_check BOOLEAN DEFAULT false;

COMMENT ON COLUMN fleet_check_records.is_calibration_check IS 'True if this check was the calibration check-in';

-- ============================================================================
-- 4. Add storage service URL column to fleet_check_photos
-- ============================================================================
-- Support both old public folder paths and new VF Storage Service URLs

ALTER TABLE fleet_check_photos
    ADD COLUMN IF NOT EXISTS storage_service_url TEXT;

COMMENT ON COLUMN fleet_check_photos.storage_service_url IS 'URL from VF Storage Service (new system)';
COMMENT ON COLUMN fleet_check_photos.file_url IS 'Legacy URL from public folder or full URL for display';

-- ============================================================================
-- 5. Add verification photo support to fleet_check_photos
-- ============================================================================
-- The 'odometer_override' photo type was already added in the app code
-- This ensures it's documented in the schema

COMMENT ON COLUMN fleet_check_photos.photo_type IS 'Photo type: front, rear, dashboard, damage, fuel_gauge, odometer, odometer_override, calibration_dashboard';

-- ============================================================================
-- 6. Trigger for updated_at timestamps
-- ============================================================================

CREATE OR REPLACE FUNCTION update_fleet_calibration_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_calibration_updated ON fleet_vehicle_calibration;
CREATE TRIGGER trg_fleet_calibration_updated
    BEFORE UPDATE ON fleet_vehicle_calibration
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_calibration_timestamp();

-- ============================================================================
-- 7. Function to check if vehicle needs calibration
-- ============================================================================

CREATE OR REPLACE FUNCTION fleet_vehicle_needs_calibration(p_vehicle_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_calibration BOOLEAN;
    v_has_check_records BOOLEAN;
BEGIN
    -- Check if active calibration exists
    SELECT EXISTS(
        SELECT 1 FROM fleet_vehicle_calibration
        WHERE vehicle_id = p_vehicle_id AND is_active = true
    ) INTO v_has_calibration;

    -- If has calibration, no need
    IF v_has_calibration THEN
        RETURN false;
    END IF;

    -- Check if any check records exist (grandfathered vehicles)
    SELECT EXISTS(
        SELECT 1 FROM fleet_check_records
        WHERE vehicle_id = p_vehicle_id
    ) INTO v_has_check_records;

    -- If no calibration and no check records, needs calibration
    -- If no calibration but has records, vehicle is grandfathered
    RETURN NOT v_has_check_records;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fleet_vehicle_needs_calibration IS 'Returns true if vehicle needs first-time calibration';

-- ============================================================================
-- 8. View for calibration status
-- ============================================================================

CREATE OR REPLACE VIEW fleet_calibration_status AS
SELECT
    v.id AS vehicle_id,
    v.registration_number,
    v.make,
    v.model,
    c.id AS calibration_id,
    c.baseline_odometer,
    c.baseline_fuel_level,
    c.calibrated_at,
    c.calibrated_by_name,
    c.dashboard_photo_url,
    c.vlm_learning_status,
    c.is_active AS has_active_calibration,
    fleet_vehicle_needs_calibration(v.id) AS needs_calibration,
    (SELECT COUNT(*) FROM fleet_check_records WHERE vehicle_id = v.id) AS check_count
FROM fleet_vehicles v
LEFT JOIN fleet_vehicle_calibration c ON v.id = c.vehicle_id AND c.is_active = true
WHERE v.status = 'active';

COMMENT ON VIEW fleet_calibration_status IS 'View showing calibration status for all active vehicles';

-- ============================================================================
-- Done
-- ============================================================================
