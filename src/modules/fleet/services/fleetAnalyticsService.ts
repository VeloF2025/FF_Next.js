/**
 * Fleet Analytics Service
 * Provides methods for KPI dashboard, TCO calculations, cost trends, and analytics snapshots
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  FleetKPIs,
  VehicleTCO,
  TCOReport,
  CostTrendPoint,
  CostTrendReport,
  AnalyticsSnapshot,
  VehicleTCORow,
  rowToVehicleTCO,
  rowToAnalyticsSnapshot,
  AnalyticsSnapshotRow,
} from '../types/analytics.types';
import type {
  ServiceUrgency,
  UpcomingService,
  UpcomingServiceRow,
  rowToUpcomingService,
} from '../types/maintenance.types';
import type {
  DriverCompliance,
  DriverComplianceRow,
  rowToDriverCompliance,
} from '../types/driver-score.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// Fleet KPIs
// ============================================================================

/**
 * Get fleet-wide KPI summary
 */
export async function getFleetKPIs(): Promise<FleetKPIs> {
  try {
    // Get fleet overview counts
    const fleetOverview = await sql`
      SELECT
        COUNT(*) as total_vehicles,
        COUNT(*) FILTER (WHERE status = 'active') as active_vehicles,
        COUNT(*) FILTER (WHERE ownership_type IN ('leased', 'rental')) as leased_vehicles,
        COUNT(*) FILTER (WHERE ownership_type = 'company') as company_vehicles
      FROM fleet_vehicles
      WHERE status != 'retired'
    `;

    // Get TCO summary from view
    const tcoSummary = await sql`
      SELECT
        COALESCE(SUM(tco_12m), 0) as total_tco_12m,
        COALESCE(SUM(lease_cost_12m), 0) as total_lease_cost_12m,
        COALESCE(SUM(fuel_cost_12m), 0) as total_fuel_cost_12m,
        COALESCE(SUM(service_cost_12m), 0) as total_maintenance_cost_12m,
        COALESCE(SUM(km_travelled_12m), 0) as total_km_travelled_12m,
        AVG(cost_per_km_12m) FILTER (WHERE cost_per_km_12m IS NOT NULL) as avg_cost_per_km,
        AVG(litres_per_100km) FILTER (WHERE litres_per_100km IS NOT NULL) as fleet_avg_fuel_consumption
      FROM v_fleet_tco_summary
    `;

    // Get check-in compliance
    const complianceStats = await sql`
      SELECT
        AVG(compliance_rate) as avg_compliance_rate,
        COUNT(*) FILTER (WHERE days_since_last_check > 3) as vehicles_with_overdue_checks
      FROM v_fleet_check_compliance
    `;

    // Get upcoming services
    const serviceStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE urgency = 'overdue') as services_overdue,
        COUNT(*) FILTER (WHERE urgency IN ('warning', 'critical')) as services_due_soon
      FROM v_fleet_upcoming_services
    `;

    // Get expiring items
    const expiringItems = await sql`
      SELECT
        COUNT(*) FILTER (WHERE item_type = 'license_disc' AND days_until_expiry <= 30) as expiring_license_discs,
        COUNT(*) FILTER (WHERE item_type = 'insurance' AND days_until_expiry <= 30) as expiring_insurance,
        COUNT(*) FILTER (WHERE item_type = 'lease' AND days_until_expiry <= 30) as expiring_leases
      FROM fleet_expiring_items
      WHERE days_until_expiry > 0
    `;

    // Get previous period for trends (compare to previous 12 months)
    const previousTco = await sql`
      SELECT AVG(total_tco) as prev_avg_tco
      FROM fleet_analytics_snapshots
      WHERE snapshot_type = 'monthly'
        AND snapshot_date >= CURRENT_DATE - INTERVAL '24 months'
        AND snapshot_date < CURRENT_DATE - INTERVAL '12 months'
    `;

    const overview = fleetOverview[0] || { total_vehicles: 0, active_vehicles: 0, leased_vehicles: 0, company_vehicles: 0 };
    const tco = tcoSummary[0] || { total_tco_12m: 0, total_lease_cost_12m: 0, total_fuel_cost_12m: 0, total_maintenance_cost_12m: 0, total_km_travelled_12m: 0, avg_cost_per_km: null, fleet_avg_fuel_consumption: null };
    const compliance = complianceStats[0] || { avg_compliance_rate: null, vehicles_with_overdue_checks: 0 };
    const services = serviceStats[0] || { services_overdue: 0, services_due_soon: 0 };
    const expiring = expiringItems[0] || { expiring_license_discs: 0, expiring_insurance: 0, expiring_leases: 0 };

    const totalVehicles = Number(overview.total_vehicles) || 0;
    const totalKm = parseFloat(String(tco.total_km_travelled_12m)) || 0;

    return {
      // Fleet overview
      totalVehicles,
      activeVehicles: Number(overview.active_vehicles) || 0,
      leasedVehicles: Number(overview.leased_vehicles) || 0,
      companyVehicles: Number(overview.company_vehicles) || 0,

      // Financial KPIs
      totalTCO12m: parseFloat(String(tco.total_tco_12m)) || 0,
      totalLeaseCost12m: parseFloat(String(tco.total_lease_cost_12m)) || 0,
      avgCostPerKm: tco.avg_cost_per_km ? parseFloat(String(tco.avg_cost_per_km)) : null,
      totalFuelCost12m: parseFloat(String(tco.total_fuel_cost_12m)) || 0,
      totalMaintenanceCost12m: parseFloat(String(tco.total_maintenance_cost_12m)) || 0,

      // Efficiency KPIs
      fleetAvgFuelConsumption: tco.fleet_avg_fuel_consumption
        ? parseFloat(String(tco.fleet_avg_fuel_consumption))
        : null,
      totalKmTravelled12m: totalKm,
      avgKmPerVehicle: totalVehicles > 0 ? totalKm / totalVehicles : 0,

      // Compliance KPIs
      checkInComplianceRate: compliance.avg_compliance_rate
        ? parseFloat(String(compliance.avg_compliance_rate))
        : 0,
      vehiclesWithOverdueChecks: Number(compliance.vehicles_with_overdue_checks) || 0,
      servicesOverdue: Number(services.services_overdue) || 0,
      servicesDueSoon: Number(services.services_due_soon) || 0,

      // Expiring items
      expiringLicenseDiscs: Number(expiring.expiring_license_discs) || 0,
      expiringInsurance: Number(expiring.expiring_insurance) || 0,
      expiringLeases: Number(expiring.expiring_leases) || 0,

      // Trends (placeholder - requires historical data)
      trends: {
        tcoChange: null,
        costPerKmChange: null,
        complianceChange: null,
        fuelEfficiencyChange: null,
      },

      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    log.error('Failed to get fleet KPIs', { error });
    throw error;
  }
}

// ============================================================================
// TCO Report
// ============================================================================

/**
 * Get TCO report with per-vehicle breakdown
 */
export async function getTCOReport(
  period: '12m' | 'lifetime' = '12m',
  vehicleId?: string
): Promise<TCOReport> {
  try {
    let whereClause = '';
    if (vehicleId) {
      whereClause = `WHERE vehicle_id = '${vehicleId}'`;
    }

    const vehicles = await sql`
      SELECT
        vehicle_id,
        registration,
        make,
        model,
        year,
        ownership_type,
        status,
        vehicle_added_date,
        fuel_cost_12m,
        service_cost_12m,
        lease_cost_12m,
        insurance_cost_12m,
        license_cost_12m,
        tco_12m,
        fuel_cost_lifetime,
        service_cost_lifetime,
        lease_cost_lifetime,
        tco_lifetime,
        km_travelled_12m,
        km_travelled_lifetime,
        cost_per_km_12m,
        cost_per_km_lifetime,
        litres_per_100km,
        fuel_transactions_12m,
        service_count_12m
      FROM v_fleet_tco_summary
      ${vehicleId ? sql`WHERE vehicle_id = ${vehicleId}` : sql``}
      ORDER BY tco_12m DESC
    `;

    const vehicleTCOs: VehicleTCO[] = (vehicles as VehicleTCORow[]).map((row) => ({
      vehicleId: row.vehicle_id,
      registration: row.registration,
      make: row.make,
      model: row.model,
      year: row.year,
      ownershipType: row.ownership_type as 'company' | 'leased' | 'rental',
      status: row.status,
      vehicleAddedDate: row.vehicle_added_date,
      fuelCost12m: parseFloat(String(row.fuel_cost_12m)) || 0,
      serviceCost12m: parseFloat(String(row.service_cost_12m)) || 0,
      leaseCost12m: parseFloat(String(row.lease_cost_12m)) || 0,
      insuranceCost12m: parseFloat(String(row.insurance_cost_12m)) || 0,
      licenseCost12m: parseFloat(String(row.license_cost_12m)) || 0,
      tco12m: parseFloat(String(row.tco_12m)) || 0,
      fuelCostLifetime: parseFloat(String(row.fuel_cost_lifetime)) || 0,
      serviceCostLifetime: parseFloat(String(row.service_cost_lifetime)) || 0,
      leaseCostLifetime: parseFloat(String(row.lease_cost_lifetime)) || 0,
      tcoLifetime: parseFloat(String(row.tco_lifetime)) || 0,
      kmTravelled12m: parseFloat(String(row.km_travelled_12m)) || 0,
      kmTravelledLifetime: parseFloat(String(row.km_travelled_lifetime)) || 0,
      costPerKm12m: row.cost_per_km_12m ? parseFloat(String(row.cost_per_km_12m)) : null,
      costPerKmLifetime: row.cost_per_km_lifetime ? parseFloat(String(row.cost_per_km_lifetime)) : null,
      litresPer100km: row.litres_per_100km ? parseFloat(String(row.litres_per_100km)) : null,
      fuelTransactions12m: Number(row.fuel_transactions_12m) || 0,
      serviceCount12m: Number(row.service_count_12m) || 0,
    }));

    // Calculate totals
    const is12m = period === '12m';
    const fleetTotalTCO = vehicleTCOs.reduce(
      (sum, v) => sum + (is12m ? v.tco12m : v.tcoLifetime),
      0
    );
    const fleetTotalKm = vehicleTCOs.reduce(
      (sum, v) => sum + (is12m ? v.kmTravelled12m : v.kmTravelledLifetime),
      0
    );

    // Cost breakdown
    const costBreakdown = {
      fuel: vehicleTCOs.reduce((sum, v) => sum + (is12m ? v.fuelCost12m : v.fuelCostLifetime), 0),
      service: vehicleTCOs.reduce((sum, v) => sum + (is12m ? v.serviceCost12m : v.serviceCostLifetime), 0),
      lease: vehicleTCOs.reduce((sum, v) => sum + (is12m ? v.leaseCost12m : v.leaseCostLifetime), 0),
      insurance: vehicleTCOs.reduce((sum, v) => sum + v.insuranceCost12m, 0),
      license: vehicleTCOs.reduce((sum, v) => sum + v.licenseCost12m, 0),
    };

    // By ownership type
    const company = vehicleTCOs.filter(v => v.ownershipType === 'company');
    const leased = vehicleTCOs.filter(v => v.ownershipType === 'leased');
    const rental = vehicleTCOs.filter(v => v.ownershipType === 'rental');

    const sumTCO = (arr: VehicleTCO[]) =>
      arr.reduce((sum, v) => sum + (is12m ? v.tco12m : v.tcoLifetime), 0);

    return {
      period,
      generatedAt: new Date().toISOString(),
      fleetTotalTCO,
      fleetAvgTCO: vehicleTCOs.length > 0 ? fleetTotalTCO / vehicleTCOs.length : 0,
      fleetAvgCostPerKm: fleetTotalKm > 0 ? fleetTotalTCO / fleetTotalKm : null,
      fleetTotalKm,
      costBreakdown,
      byOwnershipType: {
        company: {
          count: company.length,
          totalTCO: sumTCO(company),
          avgTCO: company.length > 0 ? sumTCO(company) / company.length : 0,
        },
        leased: {
          count: leased.length,
          totalTCO: sumTCO(leased),
          avgTCO: leased.length > 0 ? sumTCO(leased) / leased.length : 0,
        },
        rental: {
          count: rental.length,
          totalTCO: sumTCO(rental),
          avgTCO: rental.length > 0 ? sumTCO(rental) / rental.length : 0,
        },
      },
      vehicles: vehicleTCOs,
    };
  } catch (error) {
    log.error('Failed to get TCO report', { error, period, vehicleId });
    throw error;
  }
}

// ============================================================================
// Cost Trends
// ============================================================================

/**
 * Get cost trends over time
 */
export async function getCostTrends(
  period: 'daily' | 'weekly' | 'monthly' = 'monthly',
  months: number = 12,
  vehicleId?: string
): Promise<CostTrendReport> {
  try {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    let dateFormat: string;
    let intervalGroup: string;

    switch (period) {
      case 'daily':
        dateFormat = 'YYYY-MM-DD';
        intervalGroup = "DATE_TRUNC('day', transaction_date)";
        break;
      case 'weekly':
        dateFormat = 'YYYY-WW';
        intervalGroup = "DATE_TRUNC('week', transaction_date)";
        break;
      case 'monthly':
      default:
        dateFormat = 'YYYY-MM';
        intervalGroup = "DATE_TRUNC('month', transaction_date)";
        break;
    }

    // Get fuel costs by period
    const fuelTrends = await sql`
      SELECT
        DATE_TRUNC(${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}, transaction_date) as period_date,
        TO_CHAR(transaction_date, ${dateFormat}) as period_label,
        COALESCE(SUM(amount_rand), 0) as fuel_cost,
        COALESCE(SUM(litres), 0) as total_litres
      FROM fleet_fuel_transactions
      WHERE transaction_date >= ${startDate.toISOString().split('T')[0]}
        ${vehicleId ? sql`AND vehicle_id = ${vehicleId}` : sql``}
      GROUP BY 1, 2
      ORDER BY 1
    `;

    // Get odometer data for km calculation
    const kmTrends = await sql`
      SELECT
        DATE_TRUNC(${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}, recorded_at) as period_date,
        SUM(km_since_last) as km_travelled
      FROM fleet_odometer_history
      WHERE recorded_at >= ${startDate.toISOString().split('T')[0]}
        AND km_since_last IS NOT NULL
        ${vehicleId ? sql`AND vehicle_id = ${vehicleId}` : sql``}
      GROUP BY 1
      ORDER BY 1
    `;

    // Get maintenance costs by period
    const maintenanceTrends = await sql`
      SELECT
        DATE_TRUNC(${period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month'}, service_date) as period_date,
        COALESCE(SUM(total_cost), 0) as maintenance_cost
      FROM fleet_service_history
      WHERE service_date >= ${startDate.toISOString().split('T')[0]}
        ${vehicleId ? sql`AND vehicle_id = ${vehicleId}` : sql``}
      GROUP BY 1
      ORDER BY 1
    `;

    // Combine into data points
    type FuelRow = { period_date: string; period_label: string; fuel_cost: string; total_litres: string };
    type KmRow = { period_date: string; km_travelled: string };
    type MaintenanceRow = { period_date: string; maintenance_cost: string };

    const fuelMap = new Map((fuelTrends as FuelRow[]).map((r) => [
      r.period_date,
      { fuelCost: parseFloat(r.fuel_cost), totalLitres: parseFloat(r.total_litres), period: r.period_label }
    ]));
    const kmMap = new Map((kmTrends as KmRow[]).map((r) => [
      r.period_date,
      parseFloat(r.km_travelled) || 0
    ]));
    const maintenanceMap = new Map((maintenanceTrends as MaintenanceRow[]).map((r) => [
      r.period_date,
      parseFloat(r.maintenance_cost) || 0
    ]));

    // Get all unique dates
    const allDates = new Set([
      ...fuelMap.keys(),
      ...kmMap.keys(),
      ...maintenanceMap.keys(),
    ]);

    const dataPoints: CostTrendPoint[] = Array.from(allDates)
      .sort()
      .map(date => {
        const fuel = fuelMap.get(date) || { fuelCost: 0, totalLitres: 0, period: '' };
        const km = kmMap.get(date) || 0;
        const maintenance = maintenanceMap.get(date) || 0;
        const totalCost = fuel.fuelCost + maintenance;

        return {
          date,
          period: fuel.period || new Date(date).toISOString().substring(0, 10),
          fuelCost: fuel.fuelCost,
          maintenanceCost: maintenance,
          leaseCost: 0, // Would need lease data
          insuranceCost: 0, // Would need insurance data
          totalCost,
          kmTravelled: km,
          costPerKm: km > 0 ? totalCost / km : null,
          fuelConsumption: km > 0 && fuel.totalLitres > 0 ? (fuel.totalLitres / km) * 100 : null,
        };
      });

    // Calculate summary
    const totalCost = dataPoints.reduce((sum, p) => sum + p.totalCost, 0);
    const totalKm = dataPoints.reduce((sum, p) => sum + p.kmTravelled, 0);
    const costsPerKm = dataPoints.filter(p => p.costPerKm !== null).map(p => p.costPerKm!);

    return {
      period,
      startDate: startDate.toISOString().split('T')[0] || '',
      endDate: new Date().toISOString().split('T')[0] || '',
      dataPoints,
      summary: {
        avgCostPerKm: totalKm > 0 ? totalCost / totalKm : null,
        minCostPerKm: costsPerKm.length > 0 ? Math.min(...costsPerKm) : null,
        maxCostPerKm: costsPerKm.length > 0 ? Math.max(...costsPerKm) : null,
        totalCost,
        totalKm,
      },
    };
  } catch (error) {
    log.error('Failed to get cost trends', { error, period, months, vehicleId });
    throw error;
  }
}

// ============================================================================
// Analytics Snapshots
// ============================================================================

/**
 * Generate daily analytics snapshot (for cron job)
 */
export async function generateDailySnapshot(): Promise<AnalyticsSnapshot> {
  try {
    const snapshotDate = new Date().toISOString().split('T')[0];

    // Get fleet overview
    const fleetOverview = await sql`
      SELECT
        COUNT(*) as total_vehicles,
        COUNT(*) FILTER (WHERE status = 'active') as active_vehicles,
        COUNT(*) FILTER (WHERE ownership_type IN ('leased', 'rental')) as leased_vehicles,
        COUNT(*) FILTER (WHERE ownership_type = 'company') as company_vehicles
      FROM fleet_vehicles
      WHERE status != 'retired'
    `;

    // Get TCO aggregates
    const tcoAggregates = await sql`
      SELECT
        COALESCE(SUM(fuel_cost_12m), 0) as total_fuel_cost,
        COALESCE(SUM(service_cost_12m), 0) as total_maintenance_cost,
        COALESCE(SUM(lease_cost_12m), 0) as total_lease_cost,
        COALESCE(SUM(insurance_cost_12m), 0) as total_insurance_cost,
        COALESCE(SUM(license_cost_12m), 0) as total_license_cost,
        COALESCE(SUM(tco_12m), 0) as total_tco,
        COALESCE(SUM(km_travelled_12m), 0) as total_km_travelled,
        AVG(cost_per_km_12m) FILTER (WHERE cost_per_km_12m IS NOT NULL) as avg_cost_per_km,
        AVG(litres_per_100km) FILTER (WHERE litres_per_100km IS NOT NULL) as avg_fuel_consumption
      FROM v_fleet_tco_summary
    `;

    // Get compliance average
    const complianceAvg = await sql`
      SELECT AVG(compliance_rate) as avg_compliance
      FROM v_fleet_check_compliance
    `;

    const overview = fleetOverview[0] || { total_vehicles: 0, active_vehicles: 0, leased_vehicles: 0, company_vehicles: 0 };
    const tco = tcoAggregates[0] || { total_km_travelled: '0', total_fuel_cost: '0', total_maintenance_cost: '0', total_lease_cost: '0', total_insurance_cost: '0', total_license_cost: '0', total_tco: '0', avg_cost_per_km: null, avg_fuel_consumption: null };
    const compliance = complianceAvg[0] || { avg_compliance: null };
    const totalVehicles = Number(overview.total_vehicles) || 0;
    const totalKm = parseFloat(String(tco.total_km_travelled)) || 0;

    // Insert snapshot
    const result = await sql`
      INSERT INTO fleet_analytics_snapshots (
        snapshot_date,
        snapshot_type,
        total_vehicles,
        active_vehicles,
        leased_vehicles,
        company_vehicles,
        total_km_travelled,
        avg_km_per_vehicle,
        total_fuel_cost,
        total_maintenance_cost,
        total_lease_cost,
        total_insurance_cost,
        total_license_cost,
        total_tco,
        avg_cost_per_km,
        avg_fuel_consumption,
        avg_check_in_compliance
      ) VALUES (
        ${snapshotDate},
        'daily',
        ${Number(overview.total_vehicles)},
        ${Number(overview.active_vehicles)},
        ${Number(overview.leased_vehicles)},
        ${Number(overview.company_vehicles)},
        ${parseFloat(String(tco.total_km_travelled)) || 0},
        ${totalVehicles > 0 ? totalKm / totalVehicles : 0},
        ${parseFloat(String(tco.total_fuel_cost)) || 0},
        ${parseFloat(String(tco.total_maintenance_cost)) || 0},
        ${parseFloat(String(tco.total_lease_cost)) || 0},
        ${parseFloat(String(tco.total_insurance_cost)) || 0},
        ${parseFloat(String(tco.total_license_cost)) || 0},
        ${parseFloat(String(tco.total_tco)) || 0},
        ${tco.avg_cost_per_km ? parseFloat(String(tco.avg_cost_per_km)) : null},
        ${tco.avg_fuel_consumption ? parseFloat(String(tco.avg_fuel_consumption)) : null},
        ${compliance.avg_compliance ? parseFloat(String(compliance.avg_compliance)) : null}
      )
      ON CONFLICT (snapshot_date, snapshot_type) DO UPDATE SET
        total_vehicles = EXCLUDED.total_vehicles,
        active_vehicles = EXCLUDED.active_vehicles,
        leased_vehicles = EXCLUDED.leased_vehicles,
        company_vehicles = EXCLUDED.company_vehicles,
        total_km_travelled = EXCLUDED.total_km_travelled,
        avg_km_per_vehicle = EXCLUDED.avg_km_per_vehicle,
        total_fuel_cost = EXCLUDED.total_fuel_cost,
        total_maintenance_cost = EXCLUDED.total_maintenance_cost,
        total_lease_cost = EXCLUDED.total_lease_cost,
        total_insurance_cost = EXCLUDED.total_insurance_cost,
        total_license_cost = EXCLUDED.total_license_cost,
        total_tco = EXCLUDED.total_tco,
        avg_cost_per_km = EXCLUDED.avg_cost_per_km,
        avg_fuel_consumption = EXCLUDED.avg_fuel_consumption,
        avg_check_in_compliance = EXCLUDED.avg_check_in_compliance
      RETURNING *
    `;

    log.info('Generated daily analytics snapshot', { snapshotDate });

    const snapshotRow = result[0];
    if (!snapshotRow) {
      throw new Error('Failed to create snapshot - no result returned');
    }

    return {
      id: snapshotRow.id,
      snapshotDate: snapshotRow.snapshot_date,
      snapshotType: snapshotRow.snapshot_type,
      totalVehicles: snapshotRow.total_vehicles,
      activeVehicles: snapshotRow.active_vehicles,
      leasedVehicles: snapshotRow.leased_vehicles,
      companyVehicles: snapshotRow.company_vehicles,
      totalKmTravelled: parseFloat(String(snapshotRow.total_km_travelled)) || 0,
      avgKmPerVehicle: parseFloat(String(snapshotRow.avg_km_per_vehicle)) || 0,
      totalFuelCost: parseFloat(String(snapshotRow.total_fuel_cost)) || 0,
      totalMaintenanceCost: parseFloat(String(snapshotRow.total_maintenance_cost)) || 0,
      totalLeaseCost: parseFloat(String(snapshotRow.total_lease_cost)) || 0,
      totalInsuranceCost: parseFloat(String(snapshotRow.total_insurance_cost)) || 0,
      totalLicenseCost: parseFloat(String(snapshotRow.total_license_cost)) || 0,
      totalTco: parseFloat(String(snapshotRow.total_tco)) || 0,
      avgCostPerKm: snapshotRow.avg_cost_per_km ? parseFloat(String(snapshotRow.avg_cost_per_km)) : null,
      avgFuelConsumption: snapshotRow.avg_fuel_consumption ? parseFloat(String(snapshotRow.avg_fuel_consumption)) : null,
      avgCheckInCompliance: snapshotRow.avg_check_in_compliance ? parseFloat(String(snapshotRow.avg_check_in_compliance)) : null,
      vehicleMetrics: null,
      driverMetrics: null,
      costBreakdown: null,
      createdAt: snapshotRow.created_at,
    };
  } catch (error) {
    log.error('Failed to generate daily snapshot', { error });
    throw error;
  }
}

// ============================================================================
// Compliance & Service Queries
// ============================================================================

/**
 * Get driver compliance data
 */
export async function getDriverCompliance(): Promise<DriverCompliance[]> {
  try {
    const rows = await sql`
      SELECT
        staff_id,
        driver_name,
        driver_phone,
        driver_email,
        vehicle_id,
        registration,
        days_assigned,
        assigned_date,
        returned_date,
        total_checks,
        checks_30d,
        checks_7d,
        critical_issues,
        minor_issues,
        approved_checks,
        rejected_checks,
        last_check_date,
        compliance_rate,
        days_since_last_check
      FROM v_fleet_check_compliance
      ORDER BY compliance_rate ASC
    `;

    return (rows as DriverComplianceRow[]).map((row) => ({
      staffId: row.staff_id,
      driverName: row.driver_name,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      daysAssigned: row.days_assigned,
      assignedDate: row.assigned_date,
      returnedDate: row.returned_date,
      totalChecks: row.total_checks,
      checks30d: row.checks_30d,
      checks7d: row.checks_7d,
      criticalIssues: row.critical_issues,
      minorIssues: row.minor_issues,
      approvedChecks: row.approved_checks,
      rejectedChecks: row.rejected_checks,
      lastCheckDate: row.last_check_date,
      complianceRate: parseFloat(String(row.compliance_rate)) || 0,
      daysSinceLastCheck: row.days_since_last_check,
    }));
  } catch (error) {
    log.error('Failed to get driver compliance', { error });
    throw error;
  }
}

/**
 * Get upcoming services
 */
export async function getUpcomingServices(
  days: number = 90,
  urgency?: ServiceUrgency
): Promise<UpcomingService[]> {
  try {
    let rows;
    if (urgency) {
      rows = await sql`
        SELECT *
        FROM v_fleet_upcoming_services
        WHERE urgency = ${urgency}
          OR (days_until_due IS NOT NULL AND days_until_due <= ${days})
          OR (km_until_due IS NOT NULL AND km_until_due <= 5000)
        ORDER BY
          CASE urgency
            WHEN 'overdue' THEN 0
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
          END,
          days_until_due NULLS LAST
      `;
    } else {
      rows = await sql`
        SELECT *
        FROM v_fleet_upcoming_services
        WHERE urgency != 'ok'
          OR (days_until_due IS NOT NULL AND days_until_due <= ${days})
          OR (km_until_due IS NOT NULL AND km_until_due <= 5000)
        ORDER BY
          CASE urgency
            WHEN 'overdue' THEN 0
            WHEN 'critical' THEN 1
            WHEN 'warning' THEN 2
            ELSE 3
          END,
          days_until_due NULLS LAST
      `;
    }

    return (rows as UpcomingServiceRow[]).map((row) => ({
      intervalId: row.interval_id,
      vehicleId: row.vehicle_id,
      registration: row.registration,
      make: row.make,
      model: row.model,
      serviceType: row.service_type as UpcomingService['serviceType'],
      intervalKm: row.interval_km,
      intervalMonths: row.interval_months,
      lastServiceKm: row.last_service_km,
      lastServiceDate: row.last_service_date,
      nextServiceKm: row.next_service_km,
      nextServiceDate: row.next_service_date,
      estimatedCost: row.estimated_cost ? parseFloat(String(row.estimated_cost)) : null,
      providerName: row.provider_name,
      currentKm: row.current_km,
      urgency: row.urgency as ServiceUrgency,
      daysUntilDue: row.days_until_due,
      kmUntilDue: row.km_until_due,
    }));
  } catch (error) {
    log.error('Failed to get upcoming services', { error, days, urgency });
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const fleetAnalyticsService = {
  getFleetKPIs,
  getTCOReport,
  getCostTrends,
  generateDailySnapshot,
  getDriverCompliance,
  getUpcomingServices,
};

export default fleetAnalyticsService;
