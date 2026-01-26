-- Migration: 131_fleet_portal_sessions.sql
-- Description: Portal sessions for plate-based authentication
-- Created: 2026-01-26
--
-- This table stores portal sessions created when drivers authenticate by scanning
-- their vehicle's license plate. The physical act of scanning the plate serves as
-- authentication - no password required.

-- ============================================================================
-- Fleet Portal Sessions Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_portal_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Session links
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
    driver_id UUID REFERENCES staff(id),  -- May be null if vehicle has no assigned driver

    -- Plate verification details
    plate_scanned VARCHAR(20) NOT NULL,  -- The plate text extracted by VLM
    confidence NUMERIC(5,4),  -- VLM confidence (0.0000 to 1.0000)

    -- Session timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,

    -- Audit trail
    ip_address VARCHAR(45),  -- IPv4 or IPv6
    user_agent TEXT,

    -- Session state
    is_active BOOLEAN DEFAULT true,  -- Can be revoked by fleet manager
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES staff(id),
    revoke_reason TEXT
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================

-- Look up session by ID (primary lookup for cookie verification)
-- Primary key already creates this index

-- Find active sessions for a vehicle
CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_vehicle
    ON fleet_portal_sessions(vehicle_id, is_active)
    WHERE is_active = true;

-- Find sessions by driver
CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_driver
    ON fleet_portal_sessions(driver_id)
    WHERE driver_id IS NOT NULL;

-- Clean up expired sessions
CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_expires
    ON fleet_portal_sessions(expires_at)
    WHERE is_active = true;

-- Audit: sessions by IP address (detect abuse)
CREATE INDEX IF NOT EXISTS idx_fleet_portal_sessions_ip
    ON fleet_portal_sessions(ip_address, created_at DESC);

-- ============================================================================
-- Portal Session Activity Log (optional audit trail)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_portal_session_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES fleet_portal_sessions(id) ON DELETE CASCADE,

    -- Activity details
    action VARCHAR(50) NOT NULL,  -- 'fuel_transaction', 'daily_checkin', 'weekly_checkin', 'view_history'
    details JSONB,

    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_fleet_portal_activity_session
    ON fleet_portal_session_activity(session_id, created_at DESC);

-- ============================================================================
-- Comments
-- ============================================================================
COMMENT ON TABLE fleet_portal_sessions IS
    'Portal sessions created via plate-based authentication. Scanning a license plate creates an 8-hour session for vehicle interactions.';

COMMENT ON COLUMN fleet_portal_sessions.plate_scanned IS
    'The license plate text extracted by VLM from the photo';

COMMENT ON COLUMN fleet_portal_sessions.confidence IS
    'VLM confidence score (0-1) for the plate extraction';

COMMENT ON COLUMN fleet_portal_sessions.is_active IS
    'Session can be revoked by fleet manager before natural expiry';

COMMENT ON TABLE fleet_portal_session_activity IS
    'Audit log of actions taken during a portal session';
