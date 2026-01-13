-- Migration 033: Add UPS serial column to onemap_properties
-- Purpose: Store Mini-UPS/Gizzu serial number from 1Map (br_ser field)
-- Date: 2026-01-13
-- Related: Stage 3 of Site Stock Tracking implementation

-- Add ups_serial column to onemap_properties table
ALTER TABLE onemap_properties
  ADD COLUMN IF NOT EXISTS ups_serial VARCHAR(255);

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_onemap_properties_ups_serial ON onemap_properties(ups_serial);

-- Comment for documentation
COMMENT ON COLUMN onemap_properties.ups_serial IS 'Mini-UPS/Gizzu serial number from 1Map (br_ser field)';
