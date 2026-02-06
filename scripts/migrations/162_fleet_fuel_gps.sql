-- Migration: Add GPS coordinates to fleet_fuel_transactions
-- Purpose: Capture location data for fuel transactions for fraud prevention and offline sync

-- Add GPS columns to fuel transactions
ALTER TABLE fleet_fuel_transactions
ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(11, 8),
ADD COLUMN IF NOT EXISTS capture_timestamp TIMESTAMPTZ;

-- Add comment for documentation
COMMENT ON COLUMN fleet_fuel_transactions.gps_lat IS 'Latitude where transaction was recorded';
COMMENT ON COLUMN fleet_fuel_transactions.gps_lng IS 'Longitude where transaction was recorded';
COMMENT ON COLUMN fleet_fuel_transactions.capture_timestamp IS 'Timestamp when the transaction was captured on device';

-- Create index for location-based queries
CREATE INDEX IF NOT EXISTS idx_fleet_fuel_transactions_gps
ON fleet_fuel_transactions (gps_lat, gps_lng)
WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL;
