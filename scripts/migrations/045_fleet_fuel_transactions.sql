-- Fleet Fuel Transactions
-- Track fuel purchases with VLM receipt scanning and manual entry fallback

-- Fuel transactions table
CREATE TABLE IF NOT EXISTS fleet_fuel_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Transaction details
    transaction_date DATE NOT NULL,
    amount_rand NUMERIC(10,2) NOT NULL,
    litres NUMERIC(10,3) NOT NULL,
    price_per_litre NUMERIC(10,3),

    -- Odometer at fill-up
    odometer_reading INTEGER,
    km_since_last_fill INTEGER,
    litres_per_100km NUMERIC(6,2),

    -- Station info (from VLM or manual)
    station_name VARCHAR(255),
    station_location VARCHAR(500),

    -- Receipt data
    receipt_photo_url VARCHAR(500),
    receipt_photo_key VARCHAR(255),
    odometer_photo_url VARCHAR(500),
    odometer_photo_key VARCHAR(255),

    -- VLM extraction results
    vlm_extracted BOOLEAN DEFAULT false,
    vlm_confidence NUMERIC(5,2),
    vlm_raw_result JSONB,
    vlm_verified BOOLEAN DEFAULT false,

    -- Entry source
    source VARCHAR(20) DEFAULT 'manual' CHECK (source IN ('manual', 'vlm', 'hybrid')),

    -- Staff who recorded
    recorded_by UUID REFERENCES staff(id),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_vehicle ON fleet_fuel_transactions(vehicle_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_transactions_date ON fleet_fuel_transactions(transaction_date DESC);

-- Vehicle photos table for all vehicle-related photos
CREATE TABLE IF NOT EXISTS fleet_vehicle_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,

    -- Photo type: odometer, licence_plate_front, licence_plate_rear, receipt, dashboard, exterior, interior, damage, etc.
    photo_type VARCHAR(50) NOT NULL,

    -- File storage
    file_url VARCHAR(500) NOT NULL,
    file_key VARCHAR(255),
    file_size INTEGER,
    mime_type VARCHAR(50),

    -- Optional link to related records
    check_record_id UUID REFERENCES fleet_check_records(id) ON DELETE SET NULL,
    fuel_transaction_id UUID REFERENCES fleet_fuel_transactions(id) ON DELETE SET NULL,

    -- VLM processing
    vlm_processed BOOLEAN DEFAULT false,
    vlm_result JSONB,
    vlm_confidence NUMERIC(5,2),

    -- Metadata
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    captured_by UUID REFERENCES staff(id),
    notes TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON fleet_vehicle_photos(vehicle_id, photo_type);
CREATE INDEX IF NOT EXISTS idx_vehicle_photos_type ON fleet_vehicle_photos(photo_type, created_at DESC);

-- Add comments
COMMENT ON TABLE fleet_fuel_transactions IS 'Fuel purchase transactions with receipt scanning via VLM';
COMMENT ON TABLE fleet_vehicle_photos IS 'Central repository for all vehicle-related photos';
COMMENT ON COLUMN fleet_fuel_transactions.source IS 'manual: user entered, vlm: extracted from receipt, hybrid: VLM with manual corrections';
COMMENT ON COLUMN fleet_fuel_transactions.litres_per_100km IS 'Calculated fuel efficiency if odometer available';
