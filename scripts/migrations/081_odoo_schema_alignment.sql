-- Migration: 081_odoo_schema_alignment.sql
-- Purpose: Align FF schema with Odoo data requirements discovered during analysis
-- Date: 2026-01-17
--
-- Key findings from Odoo analysis:
-- 1. All 10 suppliers have MISSING emails in Odoo - need nullable email
-- 2. Fleet tracking needs service logs and odometer history
-- 3. Warehouse codes need to map to projects

-- ============================================================================
-- 1. SUPPLIERS - Make email nullable (Odoo suppliers don't have emails)
-- ============================================================================

-- Check current constraint and modify if needed
ALTER TABLE suppliers
ALTER COLUMN email DROP NOT NULL;

-- Add comment explaining why
COMMENT ON COLUMN suppliers.email IS 'Email address - nullable for Odoo imports where email may not be captured';

-- ============================================================================
-- 2. FLEET - Add service log and odometer tracking
-- ============================================================================

-- Fleet service logs (fuel, maintenance, etc.)
CREATE TABLE IF NOT EXISTS fleet_service_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- References
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    odoo_service_id INTEGER UNIQUE,  -- Odoo fleet.vehicle.log.services ID

    -- Service details
    service_date DATE NOT NULL,
    service_type TEXT NOT NULL,  -- 'fuel', 'service', 'repair', 'leasing'
    category TEXT,  -- 'service' or 'contract' from Odoo

    -- Cost tracking
    amount DECIMAL(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'ZAR',

    -- Odometer at service
    odometer_value DECIMAL(12, 2),
    odometer_unit TEXT DEFAULT 'kilometers',

    -- Details
    description TEXT,
    vendor_name TEXT,
    project_code TEXT,  -- Extracted from description (Lawley, Mohadin, etc.)

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    synced_at TIMESTAMP
);

-- Indexes for fleet service logs
CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_vehicle ON fleet_service_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_date ON fleet_service_logs(service_date);
CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_type ON fleet_service_logs(service_type);
CREATE INDEX IF NOT EXISTS idx_fleet_service_logs_project ON fleet_service_logs(project_code);

-- Fleet odometer history
CREATE TABLE IF NOT EXISTS fleet_odometer_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- References
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    odoo_odometer_id INTEGER UNIQUE,  -- Odoo fleet.vehicle.odometer ID

    -- Reading
    reading_date DATE NOT NULL,
    value DECIMAL(12, 2) NOT NULL,
    unit TEXT DEFAULT 'kilometers',

    -- Source (manual entry, service log, etc.)
    source TEXT DEFAULT 'manual',
    service_log_id UUID REFERENCES fleet_service_logs(id),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    synced_at TIMESTAMP
);

-- Indexes for odometer history
CREATE INDEX IF NOT EXISTS idx_fleet_odometer_vehicle ON fleet_odometer_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_odometer_date ON fleet_odometer_history(reading_date);

-- Add current odometer to fleet_vehicles if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fleet_vehicles' AND column_name = 'current_odometer'
    ) THEN
        ALTER TABLE fleet_vehicles ADD COLUMN current_odometer DECIMAL(12, 2);
        ALTER TABLE fleet_vehicles ADD COLUMN odometer_unit TEXT DEFAULT 'kilometers';
        ALTER TABLE fleet_vehicles ADD COLUMN last_odometer_update TIMESTAMP;
    END IF;
END $$;

-- ============================================================================
-- 3. WAREHOUSE/PROJECT MAPPING
-- ============================================================================

-- Add Odoo warehouse code to projects if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'odoo_warehouse_code'
    ) THEN
        ALTER TABLE projects ADD COLUMN odoo_warehouse_code TEXT;
        ALTER TABLE projects ADD COLUMN odoo_warehouse_id INTEGER;
    END IF;
END $$;

-- Create index for warehouse lookups
CREATE INDEX IF NOT EXISTS idx_projects_odoo_warehouse ON projects(odoo_warehouse_code);

-- ============================================================================
-- 4. SUPPLIER ENHANCEMENTS for Odoo data
-- ============================================================================

-- Add province/state field if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'suppliers' AND column_name = 'province'
    ) THEN
        ALTER TABLE suppliers ADD COLUMN province TEXT;
    END IF;

    -- Add supplier_rank from Odoo (useful for sorting)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'suppliers' AND column_name = 'supplier_rank'
    ) THEN
        ALTER TABLE suppliers ADD COLUMN supplier_rank INTEGER DEFAULT 0;
    END IF;

    -- Add reference code from Odoo
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'suppliers' AND column_name = 'reference_code'
    ) THEN
        ALTER TABLE suppliers ADD COLUMN reference_code TEXT;
    END IF;
END $$;

-- ============================================================================
-- 5. PURCHASE ORDER LINE ITEMS - Ensure we can track Odoo line IDs
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_order_items' AND column_name = 'odoo_line_id'
    ) THEN
        ALTER TABLE purchase_order_items ADD COLUMN odoo_line_id INTEGER;
    END IF;
END $$;

-- ============================================================================
-- 6. UPDATE TRIGGERS
-- ============================================================================

-- Trigger to update fleet_vehicles current_odometer from latest reading
CREATE OR REPLACE FUNCTION update_vehicle_odometer()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE fleet_vehicles
    SET
        current_odometer = NEW.value,
        odometer_unit = NEW.unit,
        last_odometer_update = NEW.reading_date
    WHERE id = NEW.vehicle_id
    AND (last_odometer_update IS NULL OR last_odometer_update <= NEW.reading_date);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_vehicle_odometer ON fleet_odometer_history;
CREATE TRIGGER trg_update_vehicle_odometer
    AFTER INSERT OR UPDATE ON fleet_odometer_history
    FOR EACH ROW
    EXECUTE FUNCTION update_vehicle_odometer();

-- ============================================================================
-- ROLLBACK COMMANDS (for reference)
-- ============================================================================
-- ALTER TABLE suppliers ALTER COLUMN email SET NOT NULL;
-- DROP TABLE IF EXISTS fleet_service_logs CASCADE;
-- DROP TABLE IF EXISTS fleet_odometer_history CASCADE;
-- ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS current_odometer;
-- ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS odometer_unit;
-- ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS last_odometer_update;
-- ALTER TABLE projects DROP COLUMN IF EXISTS odoo_warehouse_code;
-- ALTER TABLE projects DROP COLUMN IF EXISTS odoo_warehouse_id;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS province;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS supplier_rank;
-- ALTER TABLE suppliers DROP COLUMN IF EXISTS reference_code;
-- ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS odoo_line_id;
-- DROP FUNCTION IF EXISTS update_vehicle_odometer();

COMMENT ON TABLE fleet_service_logs IS 'Fleet service logs imported from Odoo - fuel, maintenance, repairs';
COMMENT ON TABLE fleet_odometer_history IS 'Historical odometer readings from Odoo fleet tracking';
