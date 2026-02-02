/**
 * Fleet Vehicle Types
 * Source of truth for company vehicle definitions
 */

// Vehicle type options
export type VehicleType = 'bakkie' | 'sedan' | 'van' | 'truck' | 'suv' | 'motorcycle' | 'other';

// Ownership type options
export type OwnershipType = 'company' | 'rental' | 'leased';

// Vehicle status options
export type VehicleStatus = 'active' | 'maintenance' | 'retired';

/**
 * Fleet Vehicle - Source of truth for vehicle details
 * Maps to fleet_vehicles table
 */
export interface FleetVehicle {
  id: string;
  registration: string;
  vehicleType: VehicleType;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  engineNumber: string | null;

  // Ownership
  ownershipType: OwnershipType;
  ownerName: string | null; // Rental company name if applicable

  // Cost rates for GPS investigation
  fuelRatePerKm: number;
  depreciationRatePerKm: number;

  // Status
  status: VehicleStatus;
  notes: string | null;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Fleet Vehicle with current assignment info
 */
export interface FleetVehicleWithAssignment extends FleetVehicle {
  currentAssignment: {
    staffId: string;
    staffName: string;
    assignedDate: string;
  } | null;
}

/**
 * Create vehicle request payload
 */
export interface CreateVehicleRequest {
  registration: string;
  vehicleType: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  engineNumber?: string;
  ownershipType?: OwnershipType;
  ownerName?: string;
  fuelRatePerKm?: number;
  depreciationRatePerKm?: number;
  notes?: string;
}

/**
 * Update vehicle request payload
 */
export interface UpdateVehicleRequest {
  registration?: string;
  vehicleType?: VehicleType;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  vin?: string | null;
  engineNumber?: string | null;
  ownershipType?: OwnershipType;
  ownerName?: string | null;
  fuelRatePerKm?: number;
  depreciationRatePerKm?: number;
  status?: VehicleStatus;
  notes?: string | null;
}

/**
 * Vehicle list filters
 */
export interface VehicleFilters {
  status?: VehicleStatus;
  vehicleType?: VehicleType;
  ownershipType?: OwnershipType;
  hasAssignment?: boolean;
  search?: string;
}

/**
 * Vehicle assignment record
 */
export interface VehicleAssignment {
  id: string;
  staffId: string;
  staffName: string;
  fleetVehicleId: string;
  assignedDate: string;
  returnedDate: string | null;
  isActive: boolean;
}

/**
 * Assign vehicle request
 */
export interface AssignVehicleRequest {
  staffId: string;
  assignedDate?: string;
  notes?: string;
}

/**
 * Database row types (snake_case from PostgreSQL)
 */
export interface FleetVehicleRow {
  id: string;
  registration: string;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  engine_number: string | null;
  ownership_type: string;
  owner_name: string | null;
  fuel_rate_per_km: string; // NUMERIC returns as string
  depreciation_rate_per_km: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to FleetVehicle
 */
export function rowToFleetVehicle(row: FleetVehicleRow): FleetVehicle {
  return {
    id: row.id,
    registration: row.registration,
    vehicleType: row.vehicle_type as VehicleType,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    vin: row.vin,
    engineNumber: row.engine_number,
    ownershipType: row.ownership_type as OwnershipType,
    ownerName: row.owner_name,
    fuelRatePerKm: parseFloat(row.fuel_rate_per_km),
    depreciationRatePerKm: parseFloat(row.depreciation_rate_per_km),
    status: row.status as VehicleStatus,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
