/**
 * Fleet Mileage Service
 * Mileage reporting: per-vehicle, fleet-wide, and project-level
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  MileagePeriod,
  MileageReport,
  VehicleMileage,
  MileagePeriodEntry,
  ProjectMileageSummary,
  MileageVehicleRow,
  MileagePeriodRow,
  ProjectMileageRow,
} from '../types/mileage.types';

const sql = neon(process.env.DATABASE_URL!);

function getPeriodParams(period: MileagePeriod): { truncPeriod: string; dateFormat: string } {
  switch (period) {
    case 'daily':
      return { truncPeriod: 'day', dateFormat: 'YYYY-MM-DD' };
    case 'weekly':
      return { truncPeriod: 'week', dateFormat: 'IYYY-"W"IW' };
    case 'monthly':
    default:
      return { truncPeriod: 'month', dateFormat: 'YYYY-MM' };
  }
}

function parseVehicleRow(row: MileageVehicleRow, daysInRange: number): VehicleMileage {
  const totalKm = parseFloat(row.total_km) || 0;
  const readingsCount = parseInt(row.readings_count) || 0;
  return {
    vehicleId: row.vehicle_id,
    registration: row.registration,
    make: row.make,
    model: row.model,
    year: row.year,
    status: row.status,
    totalKm,
    readingsCount,
    latestReading: parseInt(row.latest_reading) || 0,
    earliestReading: parseInt(row.earliest_reading) || 0,
    averagePerDay: daysInRange > 0 ? Math.round(totalKm / daysInRange) : 0,
  };
}

function parsePeriodRow(row: MileagePeriodRow): MileagePeriodEntry {
  return {
    periodLabel: row.period_label,
    periodDate: row.period_date,
    totalKm: parseFloat(row.total_km) || 0,
    readingsCount: parseInt(row.readings_count) || 0,
  };
}

/**
 * Get fleet mileage report with optional project filter
 */
export async function getFleetMileage(
  period: MileagePeriod,
  startDate: string,
  endDate: string,
  projectId?: string
): Promise<MileageReport> {
  const { truncPeriod, dateFormat } = getPeriodParams(period);
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysInRange = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Per-vehicle totals — explicit query branches (Neon rule: no conditional SQL)
  const vehicleRows = projectId
    ? await sql`
        SELECT
          fv.id as vehicle_id, fv.registration, fv.make, fv.model, fv.year, fv.status,
          COALESCE(SUM(foh.km_since_last), 0) as total_km,
          COUNT(foh.id) as readings_count,
          COALESCE(MAX(foh.reading), 0) as latest_reading,
          COALESCE(MIN(foh.reading), 0) as earliest_reading
        FROM fleet_vehicles fv
        INNER JOIN fleet_vehicle_project_assignments fvpa
          ON fvpa.vehicle_id = fv.id AND fvpa.project_id = ${projectId} AND fvpa.is_active = true
        LEFT JOIN fleet_odometer_history foh
          ON foh.vehicle_id = fv.id
          AND foh.recorded_at::date >= ${startDate}::date
          AND foh.recorded_at::date <= ${endDate}::date
          AND foh.km_since_last IS NOT NULL
        WHERE fv.status != 'retired'
        GROUP BY fv.id, fv.registration, fv.make, fv.model, fv.year, fv.status
        ORDER BY total_km DESC
      ` as MileageVehicleRow[]
    : await sql`
        SELECT
          fv.id as vehicle_id, fv.registration, fv.make, fv.model, fv.year, fv.status,
          COALESCE(SUM(foh.km_since_last), 0) as total_km,
          COUNT(foh.id) as readings_count,
          COALESCE(MAX(foh.reading), 0) as latest_reading,
          COALESCE(MIN(foh.reading), 0) as earliest_reading
        FROM fleet_vehicles fv
        LEFT JOIN fleet_odometer_history foh
          ON foh.vehicle_id = fv.id
          AND foh.recorded_at::date >= ${startDate}::date
          AND foh.recorded_at::date <= ${endDate}::date
          AND foh.km_since_last IS NOT NULL
        WHERE fv.status != 'retired'
        GROUP BY fv.id, fv.registration, fv.make, fv.model, fv.year, fv.status
        ORDER BY total_km DESC
      ` as MileageVehicleRow[];

  // Period breakdown — explicit branches
  const periodRows = projectId
    ? await sql`
        SELECT
          DATE_TRUNC(${truncPeriod}, foh.recorded_at) as period_date,
          TO_CHAR(foh.recorded_at, ${dateFormat}) as period_label,
          COALESCE(SUM(foh.km_since_last), 0) as total_km,
          COUNT(foh.id) as readings_count
        FROM fleet_odometer_history foh
        INNER JOIN fleet_vehicle_project_assignments fvpa
          ON fvpa.vehicle_id = foh.vehicle_id AND fvpa.project_id = ${projectId} AND fvpa.is_active = true
        WHERE foh.recorded_at::date >= ${startDate}::date
          AND foh.recorded_at::date <= ${endDate}::date
          AND foh.km_since_last IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
      ` as MileagePeriodRow[]
    : await sql`
        SELECT
          DATE_TRUNC(${truncPeriod}, foh.recorded_at) as period_date,
          TO_CHAR(foh.recorded_at, ${dateFormat}) as period_label,
          COALESCE(SUM(foh.km_since_last), 0) as total_km,
          COUNT(foh.id) as readings_count
        FROM fleet_odometer_history foh
        WHERE foh.recorded_at::date >= ${startDate}::date
          AND foh.recorded_at::date <= ${endDate}::date
          AND foh.km_since_last IS NOT NULL
        GROUP BY 1, 2
        ORDER BY 1
      ` as MileagePeriodRow[];

  // Get project name if filtering
  let projectName: string | null = null;
  if (projectId) {
    const projResult = await sql`SELECT project_name FROM projects WHERE id = ${projectId}`;
    projectName = projResult[0]?.project_name || null;
  }

  const vehicles = vehicleRows.map(row => parseVehicleRow(row, daysInRange));
  const periodBreakdown = periodRows.map(parsePeriodRow);
  const fleetTotalKm = vehicles.reduce((sum, v) => sum + v.totalKm, 0);
  const activeVehicles = vehicles.filter(v => v.readingsCount > 0).length;

  log.info('Fleet mileage report generated', { period, startDate, endDate, projectId, vehicleCount: vehicles.length, fleetTotalKm });

  return {
    period,
    startDate,
    endDate,
    projectId: projectId || null,
    projectName,
    vehicles,
    periodBreakdown,
    fleetTotalKm,
    fleetAveragePerVehicle: activeVehicles > 0 ? Math.round(fleetTotalKm / activeVehicles) : 0,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get mileage summaries per project (for the project dropdown/cards)
 */
export async function getProjectMileageSummaries(
  startDate: string,
  endDate: string
): Promise<ProjectMileageSummary[]> {
  const rows = await sql`
    SELECT
      p.id as project_id,
      p.project_code,
      p.project_name,
      COUNT(DISTINCT fvpa.vehicle_id) as vehicle_count,
      COALESCE(SUM(foh.km_since_last), 0) as total_km
    FROM projects p
    INNER JOIN fleet_vehicle_project_assignments fvpa
      ON fvpa.project_id = p.id AND fvpa.is_active = true
    LEFT JOIN fleet_odometer_history foh
      ON foh.vehicle_id = fvpa.vehicle_id
      AND foh.recorded_at::date >= ${startDate}::date
      AND foh.recorded_at::date <= ${endDate}::date
      AND foh.km_since_last IS NOT NULL
    GROUP BY p.id, p.project_code, p.project_name
    ORDER BY total_km DESC
  ` as ProjectMileageRow[];

  return rows.map(row => {
    const vehicleCount = parseInt(row.vehicle_count) || 0;
    const totalKm = parseFloat(row.total_km) || 0;
    return {
      projectId: row.project_id,
      projectCode: row.project_code,
      projectName: row.project_name,
      vehicleCount,
      totalKm,
      averagePerVehicle: vehicleCount > 0 ? Math.round(totalKm / vehicleCount) : 0,
    };
  });
}

export const fleetMileageService = {
  getFleetMileage,
  getProjectMileageSummaries,
};

export default fleetMileageService;
