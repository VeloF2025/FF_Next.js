/**
 * Vehicle Types - Company vehicle assignments to staff
 * Part of HR System Expansion
 */

/**
 * Vehicle assignment record
 */
export interface VehicleAssignment {
  id: string;
  staffId: string;
  fleetVehicleId?: string;
  vehicleRegistration: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehicleVin?: string;
  assignmentStart: string;
  assignmentEnd?: string;
  fuelCardNumber?: string;
  fuelCardLimit?: number;
  odometerStart?: number;
  odometerCurrent?: number;
  insurancePolicyNumber?: string;
  licenseDiscExpiry?: string;
  serviceDueDate?: string;
  serviceDueKm?: number;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Joined data
  staff?: {
    id: string;
    name: string;
    hasValidLicense?: boolean;
  };
}

/**
 * Create vehicle assignment payload
 */
export interface VehicleAssignmentCreate {
  staffId: string;
  vehicleRegistration: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehicleVin?: string;
  assignmentStart: string;
  assignmentEnd?: string;
  fuelCardNumber?: string;
  fuelCardLimit?: number;
  odometerStart?: number;
  insurancePolicyNumber?: string;
  licenseDiscExpiry?: string;
  serviceDueDate?: string;
  serviceDueKm?: number;
  notes?: string;
  /** Optional fleet vehicle ID to link this assignment to a fleet vehicle */
  fleetVehicleId?: string;
}

/**
 * Update vehicle assignment payload
 */
export interface VehicleAssignmentUpdate {
  vehicleRegistration?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehicleVin?: string;
  assignmentStart?: string;
  assignmentEnd?: string;
  fuelCardNumber?: string;
  fuelCardLimit?: number;
  odometerStart?: number;
  odometerCurrent?: number;
  insurancePolicyNumber?: string;
  licenseDiscExpiry?: string;
  serviceDueDate?: string;
  serviceDueKm?: number;
  notes?: string;
  isActive?: boolean;
}

/**
 * Vehicle summary for display
 */
export interface VehicleSummary {
  id: string;
  registration: string;
  makeModel: string;
  year?: number;
  isActive: boolean;
  assignedSince: string;
  licenseDiscExpiry?: string;
  serviceDueDate?: string;
  needsAttention: boolean;
  attentionReasons: string[];
}

/**
 * Check if vehicle needs attention (license expiry, service due, etc.)
 */
export function checkVehicleNeedsAttention(vehicle: VehicleAssignment): {
  needsAttention: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Check license disc expiry
  if (vehicle.licenseDiscExpiry) {
    const expiryDate = new Date(vehicle.licenseDiscExpiry);
    if (expiryDate < today) {
      reasons.push('License disc expired');
    } else if (expiryDate < thirtyDaysFromNow) {
      reasons.push('License disc expiring soon');
    }
  }

  // Check service due date
  if (vehicle.serviceDueDate) {
    const serviceDate = new Date(vehicle.serviceDueDate);
    if (serviceDate < today) {
      reasons.push('Service overdue');
    } else if (serviceDate < thirtyDaysFromNow) {
      reasons.push('Service due soon');
    }
  }

  // Check service due km
  if (vehicle.serviceDueKm && vehicle.odometerCurrent) {
    if (vehicle.odometerCurrent >= vehicle.serviceDueKm) {
      reasons.push('Service due (km exceeded)');
    } else if (vehicle.odometerCurrent >= vehicle.serviceDueKm - 1000) {
      reasons.push('Service due soon (km)');
    }
  }

  return {
    needsAttention: reasons.length > 0,
    reasons,
  };
}

/**
 * Format vehicle display name
 */
export function formatVehicleDisplayName(vehicle: VehicleAssignment): string {
  const parts: string[] = [];

  if (vehicle.vehicleMake) parts.push(vehicle.vehicleMake);
  if (vehicle.vehicleModel) parts.push(vehicle.vehicleModel);
  if (vehicle.vehicleYear) parts.push(`(${vehicle.vehicleYear})`);

  if (parts.length === 0) {
    return vehicle.vehicleRegistration;
  }

  return `${parts.join(' ')} - ${vehicle.vehicleRegistration}`;
}

/**
 * Common vehicle makes in South Africa
 */
export const COMMON_VEHICLE_MAKES = [
  'Toyota',
  'Volkswagen',
  'Ford',
  'Nissan',
  'Hyundai',
  'Kia',
  'Mercedes-Benz',
  'BMW',
  'Isuzu',
  'Suzuki',
  'Mazda',
  'Honda',
  'Renault',
  'Chevrolet',
  'Mitsubishi',
  'Audi',
  'Jeep',
  'Land Rover',
  'Haval',
  'GWM',
  'Other',
];

/**
 * Vehicle colors
 */
export const VEHICLE_COLORS = [
  'White',
  'Black',
  'Silver',
  'Grey',
  'Blue',
  'Red',
  'Green',
  'Yellow',
  'Orange',
  'Brown',
  'Beige',
  'Gold',
  'Other',
];
