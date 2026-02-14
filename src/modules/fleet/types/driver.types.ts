/**
 * Fleet Driver Types
 * Types for driver management, listing, and dashboard statistics
 */

/**
 * License status based on expiry date
 */
export type LicenseStatus = 'valid' | 'expiring' | 'expired' | 'none';

/**
 * Staff status (mirrors staff module enums)
 */
export type DriverStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'ON_LEAVE'
  | 'SUSPENDED'
  | 'TERMINATED'
  | 'RESIGNED'
  | 'RETIRED';

/**
 * Fleet Driver - A staff member with a verified driver's license
 */
export interface FleetDriver {
  staffId: string;
  name: string;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  department: string | null;
  position: string | null;
  status: DriverStatus;

  // License information
  hasVerifiedLicense: boolean;
  licenseExpiry: string | null;
  licenseCodes: string | null;
  licenseStatus: LicenseStatus;

  // Vehicle assignment
  hasVehicle: boolean;
  currentVehicleId: string | null;
  currentVehicleReg: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;

  // Performance scores (from fleet_driver_scores)
  compositeScore: number | null;
  totalTrips: number;
  checkInCompliance: number | null;
  fuelEfficiencyScore: number | null;
  authorizationCompliance: number | null;
  vehicleCareScore: number | null;
  lastScoreDate: string | null;
}

/**
 * Dashboard statistics for fleet drivers
 */
export interface DriverDashboardStats {
  // Driver counts
  totalDrivers: number;
  activeDrivers: number;
  formerDrivers: number;

  // Vehicle assignment
  driversWithVehicle: number;
  driversWithoutVehicle: number;

  // License status
  licensesValid: number;
  licensesExpiringSoon: number; // Within 30 days
  licensesExpired: number;

  // Performance
  avgCompositeScore: number | null;
  avgCheckInCompliance: number | null;

  // Score distribution
  scoreDistribution: {
    excellent: number; // 90+
    good: number; // 70-89
    fair: number; // 50-69
    needsImprovement: number; // <50
    noScore: number;
  };

  // License expiry timeline (next 6 months)
  licenseExpiryByMonth: Array<{
    month: string;
    count: number;
  }>;
}

/**
 * API response for GET /api/fleet/drivers
 */
export interface DriversApiResponse {
  drivers: FleetDriver[];
  summary: DriverDashboardStats;
}

/**
 * Query parameters for GET /api/fleet/drivers
 */
export interface DriversQueryParams {
  includeFormer?: boolean;
  status?: DriverStatus;
  hasVehicle?: boolean;
  search?: string;
}

/**
 * Helper: Check if driver is active (for filtering)
 */
export function isActiveDriver(driver: FleetDriver): boolean {
  return driver.status === 'ACTIVE';
}

/**
 * Helper: Get license status display color
 */
export function getLicenseStatusColor(status: LicenseStatus): string {
  switch (status) {
    case 'valid':
      return 'text-green-600';
    case 'expiring':
      return 'text-yellow-600';
    case 'expired':
      return 'text-red-600';
    case 'none':
    default:
      return 'text-gray-400';
  }
}

/**
 * Helper: Get license status label
 */
export function getLicenseStatusLabel(status: LicenseStatus): string {
  switch (status) {
    case 'valid':
      return 'Valid';
    case 'expiring':
      return 'Expiring Soon';
    case 'expired':
      return 'Expired';
    case 'none':
    default:
      return 'No License';
  }
}

/**
 * Helper: Get status badge color
 */
export function getDriverStatusColor(status: DriverStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'ON_LEAVE':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'SUSPENDED':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'INACTIVE':
    case 'TERMINATED':
    case 'RESIGNED':
    case 'RETIRED':
    default:
      return 'bg-secondary text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
  }
}
