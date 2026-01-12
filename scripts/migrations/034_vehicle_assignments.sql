-- =====================================================
-- Migration 034: Vehicle Assignments Table
-- Part of HR System Expansion (PRD-XXX)
-- =====================================================

-- Create vehicle assignments table
CREATE TABLE IF NOT EXISTS vehicle_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    vehicle_registration VARCHAR(20) NOT NULL,
    vehicle_make VARCHAR(50),
    vehicle_model VARCHAR(50),
    vehicle_year INTEGER CHECK (vehicle_year >= 1900 AND vehicle_year <= 2100),
    vehicle_color VARCHAR(30),
    vehicle_vin VARCHAR(50), -- Vehicle Identification Number
    assignment_start DATE NOT NULL,
    assignment_end DATE,
    fuel_card_number VARCHAR(50),
    fuel_card_limit DECIMAL(10,2),
    odometer_start INTEGER CHECK (odometer_start >= 0),
    odometer_current INTEGER CHECK (odometer_current >= 0),
    insurance_policy_number VARCHAR(50),
    license_disc_expiry DATE,
    service_due_date DATE,
    service_due_km INTEGER,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE vehicle_assignments IS 'Company vehicle assignments to staff members';
COMMENT ON COLUMN vehicle_assignments.vehicle_registration IS 'Vehicle registration number (license plate)';
COMMENT ON COLUMN vehicle_assignments.vehicle_vin IS 'Vehicle Identification Number (17-character code)';
COMMENT ON COLUMN vehicle_assignments.is_active IS 'Whether this assignment is currently active';
COMMENT ON COLUMN vehicle_assignments.license_disc_expiry IS 'License disc expiry date (SA vehicle license renewal)';

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_vehicle_staff ON vehicle_assignments(staff_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_active ON vehicle_assignments(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vehicle_registration ON vehicle_assignments(vehicle_registration);
CREATE INDEX IF NOT EXISTS idx_vehicle_license_expiry ON vehicle_assignments(license_disc_expiry)
    WHERE is_active = true AND license_disc_expiry IS NOT NULL;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_vehicle_assignments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vehicle_assignments_updated_at ON vehicle_assignments;
CREATE TRIGGER vehicle_assignments_updated_at
    BEFORE UPDATE ON vehicle_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_vehicle_assignments_timestamp();

-- =====================================================
-- Rollback (if needed)
-- =====================================================
-- DROP TABLE IF EXISTS vehicle_assignments CASCADE;
