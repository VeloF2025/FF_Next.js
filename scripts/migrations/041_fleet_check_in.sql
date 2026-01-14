-- Migration: 041_fleet_check_in.sql
-- Description: Daily Vehicle Check-In System
-- Created: 2026-01-14

-- ============================================================================
-- 1. Check Templates Table (Admin-configurable checklist templates)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_check_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2. Check Items Table (Individual checklist items)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_check_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES fleet_check_templates(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50), -- safety, mechanical, exterior, interior
    is_critical BOOLEAN DEFAULT false, -- blocks vehicle use if failed
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. Check Records Table (Completed check-ins)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_check_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
    template_id UUID REFERENCES fleet_check_templates(id),
    driver_id UUID NOT NULL, -- staff_id
    driver_name VARCHAR(100) NOT NULL,

    -- Check details
    check_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_time TIME NOT NULL DEFAULT CURRENT_TIME,
    odometer_reading INTEGER,

    -- Status
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    has_critical_issues BOOLEAN DEFAULT false,
    has_minor_issues BOOLEAN DEFAULT false,

    -- Approval workflow
    approved_by UUID, -- fleet manager staff_id
    approved_at TIMESTAMPTZ,
    approval_notes TEXT,

    -- Offline sync support
    sync_status VARCHAR(20) DEFAULT 'synced', -- pending, synced, conflict
    offline_id VARCHAR(100), -- client-side UUID for sync

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. Check Responses Table (Individual item responses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_check_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL REFERENCES fleet_check_records(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES fleet_check_items(id),

    -- Response
    is_passed BOOLEAN NOT NULL,
    severity VARCHAR(20), -- null if passed, 'minor' or 'critical' if failed
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 5. Check Photos Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS fleet_check_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID NOT NULL REFERENCES fleet_check_records(id) ON DELETE CASCADE,
    response_id UUID REFERENCES fleet_check_responses(id), -- null for standard photos

    -- Photo type
    photo_type VARCHAR(50) NOT NULL, -- front, rear, dashboard, damage
    is_required BOOLEAN DEFAULT true,

    -- File info
    file_url TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER,

    -- Metadata
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7)
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_fleet_check_items_template ON fleet_check_items(template_id);
CREATE INDEX IF NOT EXISTS idx_fleet_check_records_vehicle ON fleet_check_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fleet_check_records_driver ON fleet_check_records(driver_id);
CREATE INDEX IF NOT EXISTS idx_fleet_check_records_date ON fleet_check_records(check_date DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_check_records_status ON fleet_check_records(status);
CREATE INDEX IF NOT EXISTS idx_fleet_check_records_offline ON fleet_check_records(offline_id) WHERE offline_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_check_responses_record ON fleet_check_responses(record_id);
CREATE INDEX IF NOT EXISTS idx_fleet_check_photos_record ON fleet_check_photos(record_id);

-- ============================================================================
-- Insert default template with standard items
-- ============================================================================
INSERT INTO fleet_check_templates (id, name, description, is_default)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Standard Daily Check',
    'Default pre-trip vehicle inspection checklist',
    true
) ON CONFLICT (id) DO NOTHING;

-- Insert default check items
INSERT INTO fleet_check_items (template_id, name, description, category, is_critical, display_order)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'Tires', 'Check tire pressure and tread depth on all tires', 'safety', true, 1),
    ('a0000000-0000-0000-0000-000000000001', 'Lights', 'Test headlights, brake lights, indicators, and hazards', 'safety', true, 2),
    ('a0000000-0000-0000-0000-000000000001', 'Brakes', 'Test brake pedal firmness and parking brake', 'safety', true, 3),
    ('a0000000-0000-0000-0000-000000000001', 'Fluids', 'Check oil, coolant, brake fluid, and washer fluid levels', 'mechanical', false, 4),
    ('a0000000-0000-0000-0000-000000000001', 'Mirrors', 'Side and rearview mirrors clean and properly adjusted', 'safety', false, 5),
    ('a0000000-0000-0000-0000-000000000001', 'Wipers', 'Windscreen wipers functioning and blades in good condition', 'safety', false, 6),
    ('a0000000-0000-0000-0000-000000000001', 'Horn', 'Horn working correctly', 'safety', false, 7),
    ('a0000000-0000-0000-0000-000000000001', 'Seat Belts', 'Driver and passenger seat belts functioning', 'safety', true, 8),
    ('a0000000-0000-0000-0000-000000000001', 'Exterior Damage', 'Check for new dents, scratches, or cracks', 'exterior', false, 9)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Trigger for updated_at timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_fleet_check_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fleet_check_templates_updated ON fleet_check_templates;
CREATE TRIGGER trg_fleet_check_templates_updated
    BEFORE UPDATE ON fleet_check_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_check_timestamp();

DROP TRIGGER IF EXISTS trg_fleet_check_records_updated ON fleet_check_records;
CREATE TRIGGER trg_fleet_check_records_updated
    BEFORE UPDATE ON fleet_check_records
    FOR EACH ROW
    EXECUTE FUNCTION update_fleet_check_timestamp();
