/**
 * Fleet Mileage Report Types
 * Types for mileage reporting across vehicles, periods, and projects
 */

export type MileagePeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

/** Mileage data for a single vehicle over a period */
export interface VehicleMileage {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  totalKm: number;
  readingsCount: number;
  latestReading: number;
  earliestReading: number;
  averagePerDay: number;
}

/** Period breakdown entry (daily/weekly/monthly row) */
export interface MileagePeriodEntry {
  periodLabel: string;
  periodDate: string;
  totalKm: number;
  readingsCount: number;
}

/** Full mileage report response */
export interface MileageReport {
  period: MileagePeriod;
  startDate: string;
  endDate: string;
  projectId: string | null;
  projectName: string | null;
  vehicles: VehicleMileage[];
  periodBreakdown: MileagePeriodEntry[];
  fleetTotalKm: number;
  fleetAveragePerVehicle: number;
  generatedAt: string;
}

/** Project mileage summary */
export interface ProjectMileageSummary {
  projectId: string;
  projectCode: string;
  projectName: string;
  vehicleCount: number;
  totalKm: number;
  averagePerVehicle: number;
}

/** Vehicle-project assignment */
export interface VehicleProjectAssignment {
  id: string;
  vehicleId: string;
  registration: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  assignedDate: string;
  returnedDate: string | null;
  isActive: boolean;
  notes: string | null;
}

// --- SQL Row Types ---

export interface MileageVehicleRow {
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: string;
  total_km: string;
  readings_count: string;
  latest_reading: string;
  earliest_reading: string;
}

export interface MileagePeriodRow {
  period_date: string;
  period_label: string;
  total_km: string;
  readings_count: string;
}

export interface ProjectMileageRow {
  project_id: string;
  project_code: string;
  project_name: string;
  vehicle_count: string;
  total_km: string;
}

export interface VehicleProjectAssignmentRow {
  id: string;
  vehicle_id: string;
  registration: string;
  project_id: string;
  project_code: string;
  project_name: string;
  assigned_date: string;
  returned_date: string | null;
  is_active: boolean;
  notes: string | null;
}
