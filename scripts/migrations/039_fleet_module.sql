-- Migration: 039_fleet_module.sql
-- Description: Fleet Vehicle Management & GPS Trip Investigation
-- Created: 2026-01-14
-- PRD: PRD-039-fleet-module.md

-- ============================================================================
-- 1. FLEET VEHICLES TABLE (Source of truth for vehicle details)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration VARCHAR(20) NOT NULL UNIQUE,
    vehicle_type VARCHAR(50) NOT NULL, -- bakkie, sedan, van, truck, suv
    make VARCHAR(50),
    model VARCHAR(50),
    year INTEGER,
    color VARCHAR(30),
    vin VARCHAR(50),

    -- Ownership
    ownership_type VARCHAR(20) DEFAULT 'company', -- company, rental, leased
    owner_name VARCHAR(100), -- rental company name if applicable

    -- Costs (for GPS investigation)
    fuel_rate_per_km NUMERIC(10,2) DEFAULT 3.00,
    depreciation_rate_per_km NUMERIC(10,2) DEFAULT 1.50,

    -- Status
    status VARCHAR(20) DEFAULT 'active', -- active, maintenance, retired
    notes TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fleet_vehicles
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_status ON fleet_vehicles(status);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_registration ON fleet_vehicles(registration);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_type ON fleet_vehicles(vehicle_type);

-- ============================================================================
-- 2. MODIFY VEHICLE_ASSIGNMENTS TABLE (Link to fleet_vehicles)
-- ============================================================================

-- Add fleet_vehicle_id column to vehicle_assignments if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vehicle_assignments'
        AND column_name = 'fleet_vehicle_id'
    ) THEN
        ALTER TABLE vehicle_assignments
        ADD COLUMN fleet_vehicle_id UUID REFERENCES fleet_vehicles(id);
    END IF;
END $$;

-- Index for the new FK
CREATE INDEX IF NOT EXISTS idx_fleet_assignments_vehicle ON vehicle_assignments(fleet_vehicle_id);

-- ============================================================================
-- 3. AUTHORIZED LOCATIONS TABLE (Global + Per-vehicle)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_authorized_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    lat NUMERIC(10,7) NOT NULL,
    lon NUMERIC(10,7) NOT NULL,
    radius_km NUMERIC(5,2) DEFAULT 1.0,
    location_type VARCHAR(50), -- work_site, accommodation, supplier, client, office

    -- Scope
    is_global BOOLEAN DEFAULT true, -- applies to all vehicles
    vehicle_id UUID REFERENCES fleet_vehicles(id), -- null if global

    -- Status
    is_active BOOLEAN DEFAULT true,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for authorized locations
CREATE INDEX IF NOT EXISTS idx_fleet_auth_locations_vehicle ON fleet_authorized_locations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_auth_locations_global ON fleet_authorized_locations(is_global) WHERE is_global = true;
CREATE INDEX IF NOT EXISTS idx_fleet_auth_locations_active ON fleet_authorized_locations(is_active) WHERE is_active = true;

-- ============================================================================
-- 4. GPS PROCESSING JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_gps_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),

    -- File info
    file_name VARCHAR(255) NOT NULL,
    file_size INTEGER, -- bytes
    file_url TEXT, -- Firebase storage URL

    -- Processing status
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    progress INTEGER DEFAULT 0, -- 0-100
    error_message TEXT,

    -- Period analyzed
    period_start DATE,
    period_end DATE,

    -- Stats
    total_gps_points INTEGER,

    -- Generated report
    report_url TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_by UUID -- staff_id who uploaded
);

-- Indexes for GPS jobs
CREATE INDEX IF NOT EXISTS idx_fleet_gps_jobs_vehicle ON fleet_gps_jobs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_gps_jobs_status ON fleet_gps_jobs(status);
CREATE INDEX IF NOT EXISTS idx_fleet_gps_jobs_created ON fleet_gps_jobs(created_at DESC);

-- ============================================================================
-- 5. GPS TRIPS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_gps_trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES fleet_gps_jobs(id) ON DELETE CASCADE,

    -- Trip identification
    trip_number INTEGER NOT NULL,

    -- Time
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER,

    -- Start location
    start_lat NUMERIC(10,7),
    start_lon NUMERIC(10,7),
    start_location TEXT, -- Reverse geocoded address
    start_odometer NUMERIC(12,2),

    -- End location
    end_lat NUMERIC(10,7),
    end_lon NUMERIC(10,7),
    end_location TEXT, -- Reverse geocoded address
    end_odometer NUMERIC(12,2),

    -- Distance
    distance_km NUMERIC(10,2),

    -- Classification
    classification VARCHAR(20), -- AUTHORIZED, UNAUTHORIZED
    time_category VARCHAR(30), -- WORK_HOURS, AFTER_HOURS, NIGHT_TRAVEL
    day_type VARCHAR(20), -- WEEKDAY, WEEKEND

    -- Flags
    is_work_hours_violation BOOLEAN DEFAULT false,

    -- Nearest authorized location
    nearest_auth_location VARCHAR(100),
    distance_from_auth_km NUMERIC(10,2),

    -- Raw GPS points for this trip (JSON array for map visualization)
    gps_points JSONB,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for GPS trips
CREATE INDEX IF NOT EXISTS idx_fleet_gps_trips_job ON fleet_gps_trips(job_id);
CREATE INDEX IF NOT EXISTS idx_fleet_gps_trips_classification ON fleet_gps_trips(classification);
CREATE INDEX IF NOT EXISTS idx_fleet_gps_trips_start_time ON fleet_gps_trips(start_time);

-- ============================================================================
-- 6. TRIP POI TABLE (Points of Interest / Suspicious Locations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_trip_poi (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES fleet_gps_trips(id) ON DELETE CASCADE,

    -- POI position in trip
    poi_type VARCHAR(20), -- start, end, stop, nearby

    -- Location
    lat NUMERIC(10,7),
    lon NUMERIC(10,7),

    -- POI details (from Nominatim)
    category VARCHAR(100), -- bar, restaurant, casino, nightclub, etc.
    name VARCHAR(255),
    address TEXT,

    -- Risk assessment
    is_suspicious BOOLEAN DEFAULT false,
    risk_level VARCHAR(20), -- LOW, MEDIUM, HIGH, CRITICAL

    -- Distance from trip point
    distance_meters NUMERIC(10,2),

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for trip POI
CREATE INDEX IF NOT EXISTS idx_fleet_trip_poi_trip ON fleet_trip_poi(trip_id);
CREATE INDEX IF NOT EXISTS idx_fleet_trip_poi_suspicious ON fleet_trip_poi(is_suspicious) WHERE is_suspicious = true;
CREATE INDEX IF NOT EXISTS idx_fleet_trip_poi_risk ON fleet_trip_poi(risk_level);

-- ============================================================================
-- 7. INVESTIGATION SUMMARIES TABLE (Per job aggregated metrics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_investigation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE REFERENCES fleet_gps_jobs(id) ON DELETE CASCADE,

    -- Trip counts
    total_trips INTEGER DEFAULT 0,
    authorized_trips INTEGER DEFAULT 0,
    unauthorized_trips INTEGER DEFAULT 0,

    -- Distance
    total_km NUMERIC(10,2) DEFAULT 0,
    authorized_km NUMERIC(10,2) DEFAULT 0,
    unauthorized_km NUMERIC(10,2) DEFAULT 0,

    -- Pattern counts
    weekend_trips INTEGER DEFAULT 0,
    after_hours_trips INTEGER DEFAULT 0,
    night_travel_trips INTEGER DEFAULT 0,
    work_hours_violations INTEGER DEFAULT 0,
    suspicious_poi_visits INTEGER DEFAULT 0,
    unauthorized_nights INTEGER DEFAULT 0,
    consecutive_unauthorized_nights INTEGER DEFAULT 0,

    -- Financial impact
    total_cost NUMERIC(10,2) DEFAULT 0,
    authorized_cost NUMERIC(10,2) DEFAULT 0,
    unauthorized_cost NUMERIC(10,2) DEFAULT 0,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for investigation summaries
CREATE INDEX IF NOT EXISTS idx_fleet_investigation_summaries_job ON fleet_investigation_summaries(job_id);

-- ============================================================================
-- 8. MIGRATE EXISTING DATA FROM vehicle_assignments
-- ============================================================================

-- Insert existing vehicles into fleet_vehicles (if any exist)
-- This is idempotent - uses ON CONFLICT to skip duplicates
INSERT INTO fleet_vehicles (registration, make, model, year, color, vin, vehicle_type, ownership_type)
SELECT DISTINCT
    vehicle_registration,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    vehicle_vin,
    COALESCE(
        CASE
            WHEN LOWER(vehicle_make) LIKE '%toyota%' AND LOWER(vehicle_model) LIKE '%hilux%' THEN 'bakkie'
            WHEN LOWER(vehicle_model) LIKE '%bakkie%' OR LOWER(vehicle_model) LIKE '%pickup%' THEN 'bakkie'
            WHEN LOWER(vehicle_model) LIKE '%van%' THEN 'van'
            WHEN LOWER(vehicle_model) LIKE '%truck%' THEN 'truck'
            ELSE 'sedan'
        END,
        'sedan'
    ) as vehicle_type,
    'company' as ownership_type
FROM vehicle_assignments
WHERE vehicle_registration IS NOT NULL
  AND vehicle_registration != ''
ON CONFLICT (registration) DO NOTHING;

-- Link existing assignments to fleet_vehicles
UPDATE vehicle_assignments va
SET fleet_vehicle_id = fv.id
FROM fleet_vehicles fv
WHERE va.vehicle_registration = fv.registration
  AND va.fleet_vehicle_id IS NULL;

-- ============================================================================
-- 9. TRIGGER: Update updated_at on fleet_vehicles
-- ============================================================================

CREATE OR REPLACE FUNCTION update_fleet_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_fleet_vehicles_updated_at ON fleet_vehicles;
CREATE TRIGGER trigger_fleet_vehicles_updated_at
    BEFORE UPDATE ON fleet_vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_vehicles_updated_at();

-- ============================================================================
-- 10. TRIGGER: Update updated_at on fleet_authorized_locations
-- ============================================================================

CREATE OR REPLACE FUNCTION update_fleet_authorized_locations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_fleet_authorized_locations_updated_at ON fleet_authorized_locations;
CREATE TRIGGER trigger_fleet_authorized_locations_updated_at
    BEFORE UPDATE ON fleet_authorized_locations
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_authorized_locations_updated_at();

-- ============================================================================
-- VERIFICATION QUERIES (comment out in production)
-- ============================================================================

-- Verify tables created
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'fleet%';

-- Verify fleet_vehicles data migrated
-- SELECT COUNT(*) as total_vehicles FROM fleet_vehicles;

-- Verify vehicle_assignments linked
-- SELECT COUNT(*) as linked_assignments FROM vehicle_assignments WHERE fleet_vehicle_id IS NOT NULL;
