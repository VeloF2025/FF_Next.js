-- Migration 044: Link vehicle_assignments to fleet_vehicles
-- Adds fleet_vehicle_id FK to enable unified vehicle tracking

-- Add fleet_vehicle_id column
ALTER TABLE vehicle_assignments
ADD COLUMN IF NOT EXISTS fleet_vehicle_id UUID REFERENCES fleet_vehicles(id) ON DELETE SET NULL;

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_fleet_vehicle
ON vehicle_assignments(fleet_vehicle_id);

-- Create index for finding assignments by fleet vehicle
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_active_fleet
ON vehicle_assignments(fleet_vehicle_id, is_active)
WHERE is_active = true;

-- Add comment explaining the relationship
COMMENT ON COLUMN vehicle_assignments.fleet_vehicle_id IS
'Links to fleet_vehicles table for unified vehicle tracking. NULL for legacy assignments without fleet vehicle records.';
