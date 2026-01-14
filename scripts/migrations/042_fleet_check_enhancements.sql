-- Migration: 042_fleet_check_enhancements.sql
-- Description: Fleet Check-In Enhancements - Daily/Weekly checks with VLM integration
-- Created: 2026-01-14

-- ============================================================================
-- 1. Add check_type to existing tables
-- ============================================================================

-- Add check_type to records (daily vs weekly)
ALTER TABLE fleet_check_records ADD COLUMN IF NOT EXISTS check_type VARCHAR(20) DEFAULT 'daily';
COMMENT ON COLUMN fleet_check_records.check_type IS 'Type of check: daily or weekly';

-- Add check_type to templates
ALTER TABLE fleet_check_templates ADD COLUMN IF NOT EXISTS check_type VARCHAR(20) DEFAULT 'daily';
COMMENT ON COLUMN fleet_check_templates.check_type IS 'Template type: daily or weekly';

-- ============================================================================
-- 2. Odometer History Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_odometer_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    check_record_id UUID REFERENCES fleet_check_records(id) ON DELETE SET NULL,

    -- Reading data
    reading INTEGER NOT NULL CHECK (reading >= 0),
    source VARCHAR(20) NOT NULL, -- 'manual', 'vlm'
    vlm_confidence NUMERIC(3,2), -- 0.00-1.00

    -- Comparison with previous
    previous_reading INTEGER,
    km_since_last INTEGER,

    -- Discrepancy detection
    discrepancy_flag BOOLEAN DEFAULT false,
    discrepancy_reason TEXT,

    -- Timestamps
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_odometer_vehicle_date ON fleet_odometer_history(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_odometer_record ON fleet_odometer_history(check_record_id);

COMMENT ON TABLE fleet_odometer_history IS 'Historical odometer readings for vehicles';

-- ============================================================================
-- 3. Fuel Gauge History Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_fuel_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    check_record_id UUID REFERENCES fleet_check_records(id) ON DELETE SET NULL,

    -- Fuel data
    fuel_level INTEGER NOT NULL CHECK (fuel_level >= 0 AND fuel_level <= 100), -- percentage 0-100
    source VARCHAR(20) NOT NULL, -- 'manual', 'vlm'
    vlm_confidence NUMERIC(3,2), -- 0.00-1.00

    -- Comparison with previous
    previous_level INTEGER,
    level_change INTEGER, -- positive = refuel, negative = consumption

    -- Timestamps
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fuel_vehicle_date ON fleet_fuel_history(vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_record ON fleet_fuel_history(check_record_id);

COMMENT ON TABLE fleet_fuel_history IS 'Historical fuel gauge readings for vehicles';

-- ============================================================================
-- 4. VLM Photo Analysis Results
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_photo_vlm_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID NOT NULL REFERENCES fleet_check_photos(id) ON DELETE CASCADE,
    analysis_type VARCHAR(30) NOT NULL, -- 'odometer', 'license_plate', 'fuel_gauge', 'damage'

    -- Extracted data
    extracted_value TEXT, -- The OCR/VLM extracted text/number
    extracted_numeric INTEGER, -- Parsed numeric value if applicable
    confidence NUMERIC(3,2), -- 0.00-1.00

    -- License plate specific
    plate_matches_vehicle BOOLEAN,
    expected_plate VARCHAR(20),

    -- VLM metadata
    vlm_model VARCHAR(100),
    raw_response TEXT,
    processing_time_ms INTEGER,
    processing_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    error_message TEXT,

    -- Manual verification/override
    verified BOOLEAN DEFAULT false,
    verified_by UUID REFERENCES staff(id),
    verified_at TIMESTAMPTZ,
    override_value TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vlm_photo ON fleet_photo_vlm_results(photo_id);
CREATE INDEX IF NOT EXISTS idx_vlm_status ON fleet_photo_vlm_results(processing_status);
CREATE INDEX IF NOT EXISTS idx_vlm_type ON fleet_photo_vlm_results(analysis_type);

COMMENT ON TABLE fleet_photo_vlm_results IS 'VLM analysis results for check-in photos';

-- ============================================================================
-- 5. Check Schedule Tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_check_schedule (
    vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Last check dates
    daily_last_check DATE,
    weekly_last_check DATE,

    -- Configuration
    weekly_due_day INTEGER DEFAULT 1, -- 1=Monday, 2=Tuesday, etc.

    -- Reminder tracking (reset daily)
    reminder_sent_daily BOOLEAN DEFAULT false,
    reminder_sent_weekly BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fleet_check_schedule IS 'Tracks check-in schedule and reminder status per vehicle';

-- ============================================================================
-- 6. Check Reminders Log
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_check_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
    driver_id UUID NOT NULL REFERENCES staff(id),

    -- Reminder details
    check_type VARCHAR(20) NOT NULL, -- 'daily', 'weekly'
    reminder_channel VARCHAR(20) NOT NULL, -- 'email', 'whatsapp'

    -- Delivery tracking
    message_id TEXT, -- WhatsApp/email message ID
    delivery_status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'delivered', 'read', 'failed'

    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reminders_vehicle ON fleet_check_reminders(vehicle_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_driver ON fleet_check_reminders(driver_id, sent_at DESC);

COMMENT ON TABLE fleet_check_reminders IS 'Log of sent check-in reminders';

-- ============================================================================
-- 7. Per-Vehicle Threshold Configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleet_vehicle_thresholds (
    vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Manual thresholds (admin-configurable)
    daily_km_threshold INTEGER DEFAULT 500,
    weekly_km_threshold INTEGER DEFAULT 1000,

    -- Learned values (updated by monthly analysis)
    learned_avg_daily_km INTEGER,
    learned_std_deviation INTEGER,
    last_learning_update DATE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fleet_vehicle_thresholds IS 'Per-vehicle odometer discrepancy thresholds';

-- ============================================================================
-- 8. Add fuel_gauge photo type to existing enum
-- ============================================================================

-- Add new photo types if they don't exist
-- The existing types are: front, rear, dashboard, damage
-- We need to add: fuel_gauge, under_vehicle, license_disk

-- Update check_photos to support more types (schema already uses VARCHAR)
COMMENT ON COLUMN fleet_check_photos.photo_type IS 'Photo type: front, rear, dashboard, damage, fuel_gauge, under_vehicle, license_disk';

-- ============================================================================
-- 9. Insert Default Templates (Daily and Weekly)
-- ============================================================================

-- Update existing default template to be daily type
UPDATE fleet_check_templates
SET check_type = 'daily'
WHERE is_default = true AND check_type IS NULL;

-- Insert Weekly Check Template
INSERT INTO fleet_check_templates (id, name, description, check_type, is_default, is_active)
VALUES (
    'b0000000-0000-0000-0000-000000000002',
    'Weekly Pre-Trip Inspection',
    'Comprehensive weekly vehicle inspection including exterior, interior, and switch-on checks',
    'weekly',
    false,
    true
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    check_type = EXCLUDED.check_type;

-- Insert Weekly Check Items
-- Exterior Items
INSERT INTO fleet_check_items (id, template_id, name, description, category, is_critical, display_order) VALUES
    ('c0000001-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Tyres', 'Check tyre pressure, tread depth, and wheel nuts', 'exterior', true, 1),
    ('c0000001-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Lights & Indicators', 'Check all lights and indicators are clean and working', 'exterior', true, 2),
    ('c0000001-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000002', 'Mirrors', 'Check all mirrors are stable and secure', 'exterior', false, 3),
    ('c0000001-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'Windscreen', 'Check windscreen for cracks or damage', 'exterior', false, 4),
    ('c0000001-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'Wipers', 'Check wiper blades condition', 'exterior', false, 5),
    ('c0000001-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'License Disk', 'Check license disk is valid and visible', 'exterior', false, 6),
    ('c0000001-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000002', 'Number Plate', 'Check number plates are readable and secure', 'exterior', false, 7),
    ('c0000001-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000002', 'Under Vehicle', 'Check under vehicle for oil or fluid leaks', 'exterior', false, 8),
    ('c0000001-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000002', 'Exterior Damage', 'Inspect for any exterior damage (photo required if found)', 'exterior', false, 9)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_critical = EXCLUDED.is_critical,
    display_order = EXCLUDED.display_order;

-- Interior Items
INSERT INTO fleet_check_items (id, template_id, name, description, category, is_critical, display_order) VALUES
    ('c0000001-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000002', 'Seat Position', 'Check driver seat adjusts properly', 'interior', false, 10),
    ('c0000001-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000002', 'Mirrors Position', 'Check interior mirrors are positioned and visible', 'interior', false, 11),
    ('c0000001-0000-0000-0000-000000000012', 'b0000000-0000-0000-0000-000000000002', 'Door Closure', 'Check all doors close and lock properly', 'interior', false, 12),
    ('c0000001-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000002', 'Seatbelts', 'Check all seatbelts function properly', 'interior', true, 13)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_critical = EXCLUDED.is_critical,
    display_order = EXCLUDED.display_order;

-- Switch-on Items (using 'safety' category for switch-on checks)
INSERT INTO fleet_check_items (id, template_id, name, description, category, is_critical, display_order) VALUES
    ('c0000001-0000-0000-0000-000000000014', 'b0000000-0000-0000-0000-000000000002', 'Warning Lights', 'Check no warning lights are displayed on dashboard', 'safety', true, 14),
    ('c0000001-0000-0000-0000-000000000015', 'b0000000-0000-0000-0000-000000000002', 'Lights Working', 'Test all lights are working (headlights, brake, indicators)', 'safety', false, 15),
    ('c0000001-0000-0000-0000-000000000016', 'b0000000-0000-0000-0000-000000000002', 'Horn', 'Test horn is functional', 'safety', false, 16)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_critical = EXCLUDED.is_critical,
    display_order = EXCLUDED.display_order;

-- Insert Daily Check Template (simpler - just odometer and fuel)
INSERT INTO fleet_check_templates (id, name, description, check_type, is_default, is_active)
VALUES (
    'b0000000-0000-0000-0000-000000000003',
    'Daily Quick Check',
    'Quick daily check - odometer and fuel gauge photos only',
    'daily',
    true,
    true
) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    check_type = EXCLUDED.check_type,
    is_default = EXCLUDED.is_default;

-- Daily Check Items (photo-based, VLM processed)
INSERT INTO fleet_check_items (id, template_id, name, description, category, is_critical, display_order) VALUES
    ('c0000002-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'Odometer Reading', 'Take photo of odometer/dashboard for km reading', 'safety', true, 1),
    ('c0000002-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'Fuel Gauge', 'Take photo of fuel gauge showing current level', 'safety', false, 2)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_critical = EXCLUDED.is_critical,
    display_order = EXCLUDED.display_order;

-- Set the old default template as non-default (if a different one exists)
UPDATE fleet_check_templates
SET is_default = false
WHERE id NOT IN ('b0000000-0000-0000-0000-000000000003')
AND is_default = true;

-- ============================================================================
-- 10. Initialize check schedules for existing vehicles
-- ============================================================================

INSERT INTO fleet_check_schedule (vehicle_id)
SELECT id FROM fleet_vehicles
WHERE id NOT IN (SELECT vehicle_id FROM fleet_check_schedule)
ON CONFLICT (vehicle_id) DO NOTHING;

-- Initialize thresholds for existing vehicles
INSERT INTO fleet_vehicle_thresholds (vehicle_id)
SELECT id FROM fleet_vehicles
WHERE id NOT IN (SELECT vehicle_id FROM fleet_vehicle_thresholds)
ON CONFLICT (vehicle_id) DO NOTHING;

-- ============================================================================
-- Done
-- ============================================================================
