/**
 * Fleet Vehicle Scorecard Types
 * Per-vehicle analytics with driver, distance, fuel, compliance metrics
 */

/** Per-vehicle scorecard row */
export interface VehicleScorecard {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicleType: string;
  ownershipType: string;
  status: string;
  driverName: string | null;
  driverSince: string | null;
  projectCode: string | null;
  projectName: string | null;
  totalKm: number;
  latestReading: number;
  fuelCost: number;
  fuelLitres: number;
  costPerKm: number | null;
  litresPer100km: number | null;
  checkInCount: number;
  dailyChecks: number;
  weeklyChecks: number;
  lastCheckDate: string | null;
  complianceRate: number;
}

/** Fleet-level summary totals */
export interface ScorecardSummary {
  totalVehicles: number;
  activeWithData: number;
  fleetTotalKm: number;
  fleetFuelCost: number;
  fleetAvgCostPerKm: number | null;
  fleetAvgLitresPer100km: number | null;
  fleetAvgCompliance: number;
  totalCheckIns: number;
}

/** Full scorecard response */
export interface ScorecardReport {
  startDate: string;
  endDate: string;
  summary: ScorecardSummary;
  vehicles: VehicleScorecard[];
  generatedAt: string;
}

/** SQL row type for scorecard query */
export interface ScorecardRow {
  id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vehicle_type: string;
  ownership_type: string;
  status: string;
  driver_name: string | null;
  driver_since: string | null;
  project_code: string | null;
  project_name: string | null;
  total_km: string;
  latest_reading: string;
  fuel_cost: string;
  fuel_litres: string;
  check_in_count: string;
  daily_checks: string;
  weekly_checks: string;
  last_check_date: string | null;
}
