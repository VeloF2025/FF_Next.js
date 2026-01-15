/**
 * Fleet Analytics Types
 * Types for KPI Dashboard, TCO calculations, and cost trends
 */

// ============================================================================
// TCO (Total Cost of Ownership) Types
// ============================================================================

export interface VehicleTCO {
  vehicleId: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownershipType: 'company' | 'leased' | 'rental';
  status: string;
  vehicleAddedDate: string;

  // 12-Month Costs (ZAR)
  fuelCost12m: number;
  serviceCost12m: number;
  leaseCost12m: number;
  insuranceCost12m: number;
  licenseCost12m: number;
  tco12m: number;

  // Lifetime Costs (ZAR)
  fuelCostLifetime: number;
  serviceCostLifetime: number;
  leaseCostLifetime: number;
  tcoLifetime: number;

  // Distance metrics
  kmTravelled12m: number;
  kmTravelledLifetime: number;

  // Efficiency metrics
  costPerKm12m: number | null;
  costPerKmLifetime: number | null;
  litresPer100km: number | null;

  // Counts
  fuelTransactions12m: number;
  serviceCount12m: number;
}

export interface TCOReport {
  period: '12m' | 'lifetime';
  generatedAt: string;

  // Fleet totals
  fleetTotalTCO: number;
  fleetAvgTCO: number;
  fleetAvgCostPerKm: number | null;
  fleetTotalKm: number;

  // Cost breakdown
  costBreakdown: {
    fuel: number;
    service: number;
    lease: number;
    insurance: number;
    license: number;
  };

  // By ownership type
  byOwnershipType: {
    company: { count: number; totalTCO: number; avgTCO: number };
    leased: { count: number; totalTCO: number; avgTCO: number };
    rental: { count: number; totalTCO: number; avgTCO: number };
  };

  // Individual vehicles
  vehicles: VehicleTCO[];
}

// ============================================================================
// KPI Types
// ============================================================================

export interface FleetKPIs {
  // Fleet overview
  totalVehicles: number;
  activeVehicles: number;
  leasedVehicles: number;
  companyVehicles: number;

  // Financial KPIs
  totalTCO12m: number;
  totalLeaseCost12m: number;
  avgCostPerKm: number | null;
  totalFuelCost12m: number;
  totalMaintenanceCost12m: number;

  // Efficiency KPIs
  fleetAvgFuelConsumption: number | null; // L/100km
  totalKmTravelled12m: number;
  avgKmPerVehicle: number;

  // Compliance KPIs
  checkInComplianceRate: number;
  vehiclesWithOverdueChecks: number;
  servicesOverdue: number;
  servicesDueSoon: number; // within 30 days/2000km

  // Expiring items
  expiringLicenseDiscs: number;
  expiringInsurance: number;
  expiringLeases: number;

  // Trends (vs previous period)
  trends: {
    tcoChange: number | null; // percentage
    costPerKmChange: number | null;
    complianceChange: number | null;
    fuelEfficiencyChange: number | null;
  };

  generatedAt: string;
}

// ============================================================================
// Cost Trend Types
// ============================================================================

export interface CostTrendPoint {
  date: string;
  period: string; // e.g., "2026-01", "Week 1"

  // Cost components
  fuelCost: number;
  maintenanceCost: number;
  leaseCost: number;
  insuranceCost: number;
  totalCost: number;

  // Distance
  kmTravelled: number;

  // Calculated
  costPerKm: number | null;
  fuelConsumption: number | null; // L/100km
}

export interface CostTrendReport {
  period: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
  dataPoints: CostTrendPoint[];

  // Summary
  summary: {
    avgCostPerKm: number | null;
    minCostPerKm: number | null;
    maxCostPerKm: number | null;
    totalCost: number;
    totalKm: number;
  };
}

// ============================================================================
// Analytics Snapshot Types (cached daily/weekly data)
// ============================================================================

export interface AnalyticsSnapshot {
  id: string;
  snapshotDate: string;
  snapshotType: 'daily' | 'weekly' | 'monthly';

  // Fleet totals
  totalVehicles: number;
  activeVehicles: number;
  leasedVehicles: number;
  companyVehicles: number;

  // Distance
  totalKmTravelled: number;
  avgKmPerVehicle: number;

  // Costs
  totalFuelCost: number;
  totalMaintenanceCost: number;
  totalLeaseCost: number;
  totalInsuranceCost: number;
  totalLicenseCost: number;
  totalTco: number;

  // Efficiency
  avgCostPerKm: number | null;
  avgFuelConsumption: number | null;
  avgCheckInCompliance: number | null;

  // Detailed metrics
  vehicleMetrics: Record<string, VehicleSnapshotMetrics> | null;
  driverMetrics: Record<string, DriverSnapshotMetrics> | null;
  costBreakdown: CostBreakdown | null;

  createdAt: string;
}

export interface VehicleSnapshotMetrics {
  tco: number;
  costPerKm: number | null;
  fuelCost: number;
  serviceCost: number;
  kmTravelled: number;
  fuelConsumption: number | null;
}

export interface DriverSnapshotMetrics {
  compositeScore: number | null;
  checkInCompliance: number | null;
  fuelEfficiency: number | null;
  authorizationCompliance: number | null;
}

export interface CostBreakdown {
  fuel: number;
  maintenance: number;
  lease: number;
  insurance: number;
  license: number;
}

// ============================================================================
// Fleet Utilization Types
// ============================================================================

export interface FleetUtilization {
  // Active vs idle
  totalVehicles: number;
  activeVehicles: number;
  idleVehicles: number; // No trips in last 7 days
  maintenanceVehicles: number;

  // Assignment
  assignedVehicles: number;
  unassignedVehicles: number;

  // Usage metrics
  avgDailyKm: number;
  avgTripsPerDay: number;
  utilizationRate: number; // % of vehicles used daily

  // By vehicle type
  byVehicleType: Record<string, {
    count: number;
    avgDailyKm: number;
    utilizationRate: number;
  }>;
}

// ============================================================================
// Dashboard Card Types
// ============================================================================

export interface DashboardCard {
  id: string;
  title: string;
  value: string | number;
  unit?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'flat';
    isPositive: boolean;
  };
  icon?: string;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface GetFleetKPIsRequest {
  dateFrom?: string;
  dateTo?: string;
}

export interface GetTCOReportRequest {
  period: '12m' | 'lifetime';
  vehicleId?: string; // Optional: specific vehicle
}

export interface GetCostTrendsRequest {
  period: 'daily' | 'weekly' | 'monthly';
  months?: number; // Default: 12
  vehicleId?: string; // Optional: specific vehicle
}

// ============================================================================
// Database Row Types
// ============================================================================

export interface AnalyticsSnapshotRow {
  id: string;
  snapshot_date: string;
  snapshot_type: string;
  total_vehicles: number;
  active_vehicles: number;
  leased_vehicles: number;
  company_vehicles: number;
  total_km_travelled: string;
  avg_km_per_vehicle: string;
  total_fuel_cost: string;
  total_maintenance_cost: string;
  total_lease_cost: string;
  total_insurance_cost: string;
  total_license_cost: string;
  total_tco: string;
  avg_cost_per_km: string | null;
  avg_fuel_consumption: string | null;
  avg_check_in_compliance: string | null;
  vehicle_metrics: Record<string, VehicleSnapshotMetrics> | null;
  driver_metrics: Record<string, DriverSnapshotMetrics> | null;
  cost_breakdown: CostBreakdown | null;
  created_at: string;
}

export interface VehicleTCORow {
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  year: number | null;
  ownership_type: string;
  status: string;
  vehicle_added_date: string;
  fuel_cost_12m: string;
  service_cost_12m: string;
  lease_cost_12m: string;
  insurance_cost_12m: string;
  license_cost_12m: string;
  tco_12m: string;
  fuel_cost_lifetime: string;
  service_cost_lifetime: string;
  lease_cost_lifetime: string;
  tco_lifetime: string;
  km_travelled_12m: string;
  km_travelled_lifetime: string;
  cost_per_km_12m: string | null;
  cost_per_km_lifetime: string | null;
  litres_per_100km: string | null;
  fuel_transactions_12m: number;
  service_count_12m: number;
}

// ============================================================================
// Row Converters
// ============================================================================

export function rowToAnalyticsSnapshot(row: AnalyticsSnapshotRow): AnalyticsSnapshot {
  return {
    id: row.id,
    snapshotDate: row.snapshot_date,
    snapshotType: row.snapshot_type as 'daily' | 'weekly' | 'monthly',
    totalVehicles: row.total_vehicles,
    activeVehicles: row.active_vehicles,
    leasedVehicles: row.leased_vehicles,
    companyVehicles: row.company_vehicles,
    totalKmTravelled: parseFloat(row.total_km_travelled) || 0,
    avgKmPerVehicle: parseFloat(row.avg_km_per_vehicle) || 0,
    totalFuelCost: parseFloat(row.total_fuel_cost) || 0,
    totalMaintenanceCost: parseFloat(row.total_maintenance_cost) || 0,
    totalLeaseCost: parseFloat(row.total_lease_cost) || 0,
    totalInsuranceCost: parseFloat(row.total_insurance_cost) || 0,
    totalLicenseCost: parseFloat(row.total_license_cost) || 0,
    totalTco: parseFloat(row.total_tco) || 0,
    avgCostPerKm: row.avg_cost_per_km ? parseFloat(row.avg_cost_per_km) : null,
    avgFuelConsumption: row.avg_fuel_consumption ? parseFloat(row.avg_fuel_consumption) : null,
    avgCheckInCompliance: row.avg_check_in_compliance ? parseFloat(row.avg_check_in_compliance) : null,
    vehicleMetrics: row.vehicle_metrics,
    driverMetrics: row.driver_metrics,
    costBreakdown: row.cost_breakdown,
    createdAt: row.created_at,
  };
}

export function rowToVehicleTCO(row: VehicleTCORow): VehicleTCO {
  return {
    vehicleId: row.vehicle_id,
    registration: row.registration,
    make: row.make,
    model: row.model,
    year: row.year,
    ownershipType: row.ownership_type as 'company' | 'leased' | 'rental',
    status: row.status,
    vehicleAddedDate: row.vehicle_added_date,
    fuelCost12m: parseFloat(row.fuel_cost_12m) || 0,
    serviceCost12m: parseFloat(row.service_cost_12m) || 0,
    leaseCost12m: parseFloat(row.lease_cost_12m) || 0,
    insuranceCost12m: parseFloat(row.insurance_cost_12m) || 0,
    licenseCost12m: parseFloat(row.license_cost_12m) || 0,
    tco12m: parseFloat(row.tco_12m) || 0,
    fuelCostLifetime: parseFloat(row.fuel_cost_lifetime) || 0,
    serviceCostLifetime: parseFloat(row.service_cost_lifetime) || 0,
    leaseCostLifetime: parseFloat(row.lease_cost_lifetime) || 0,
    tcoLifetime: parseFloat(row.tco_lifetime) || 0,
    kmTravelled12m: parseFloat(row.km_travelled_12m) || 0,
    kmTravelledLifetime: parseFloat(row.km_travelled_lifetime) || 0,
    costPerKm12m: row.cost_per_km_12m ? parseFloat(row.cost_per_km_12m) : null,
    costPerKmLifetime: row.cost_per_km_lifetime ? parseFloat(row.cost_per_km_lifetime) : null,
    litresPer100km: row.litres_per_100km ? parseFloat(row.litres_per_100km) : null,
    fuelTransactions12m: row.fuel_transactions_12m,
    serviceCount12m: row.service_count_12m,
  };
}
