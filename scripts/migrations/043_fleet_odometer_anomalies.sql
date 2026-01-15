-- Migration: 043_fleet_odometer_anomalies.sql
-- Description: Fleet Odometer Anomaly Detection Tables
-- Created: 2026-01-14

-- ============================================================================
-- 1. Odometer Anomalies Table
-- Tracks detected discrepancies between odometer readings and expected values
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_odometer_anomalies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    odometer_history_id UUID REFERENCES fleet_odometer_history(id) ON DELETE SET NULL,

    -- Anomaly details
    anomaly_type VARCHAR(30) NOT NULL, -- 'rollback', 'excessive', 'under_reported', 'static'
    odometer_reading INTEGER NOT NULL,
    previous_reading INTEGER,
    odometer_diff INTEGER, -- km difference from previous reading

    -- GPS comparison (if available)
    gps_distance_km INTEGER, -- Total GPS distance in same period
    variance_percent NUMERIC(5,2), -- % difference between odometer and GPS

    -- Severity and status
    severity VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'warning', 'critical'
    resolved BOOLEAN DEFAULT false,
    resolved_by UUID REFERENCES staff(id),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,

    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_anomalies_vehicle ON fleet_odometer_anomalies(vehicle_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomalies_unresolved ON fleet_odometer_anomalies(resolved, severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_type ON fleet_odometer_anomalies(anomaly_type);

COMMENT ON TABLE fleet_odometer_anomalies IS 'Detected odometer discrepancies and anomalies';
COMMENT ON COLUMN fleet_odometer_anomalies.anomaly_type IS 'Type: rollback (impossible decrease), excessive (too many km), under_reported (less than GPS), static (no change)';
COMMENT ON COLUMN fleet_odometer_anomalies.variance_percent IS 'Percentage difference between odometer delta and GPS distance';

-- ============================================================================
-- 2. Add GPS comparison fields to check schedule if needed
-- ============================================================================

-- Add last_gps_comparison column to track when GPS vs odometer was last checked
ALTER TABLE fleet_check_schedule
ADD COLUMN IF NOT EXISTS last_gps_comparison DATE;

-- ============================================================================
-- Done
-- ============================================================================
