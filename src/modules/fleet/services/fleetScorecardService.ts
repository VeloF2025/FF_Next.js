/**
 * Fleet Scorecard Service
 * Per-vehicle analytics combining distance, fuel, compliance, and driver data
 *
 * KM Calculation: Uses first/last CLEAN reading (excluding discrepancy-flagged entries)
 * rather than SUM(km_since_last), which is unreliable due to:
 * - Odoo bulk imports with no previous_reading
 * - VLM misreads creating huge false deltas
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type { ScorecardReport, VehicleScorecard, ScorecardRow } from '../types/scorecard.types';

const sql = neon(process.env.DATABASE_URL!);

function countWeekdays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(count, 1);
}

function parseRow(row: ScorecardRow, expectedChecks: number, daysInRange: number): VehicleScorecard {
  const firstReading = parseInt(row.first_reading) || 0;
  const lastReading = parseInt(row.last_reading) || 0;
  const totalKm = Math.max(lastReading - firstReading, 0);
  const fuelCost = parseFloat(row.fuel_cost) || 0;
  const fuelLitres = parseFloat(row.fuel_litres) || 0;
  const checkInCount = parseInt(row.check_in_count) || 0;

  return {
    vehicleId: row.id,
    registration: row.registration,
    make: row.make,
    model: row.model,
    year: row.year,
    vehicleType: row.vehicle_type,
    ownershipType: row.ownership_type,
    status: row.status,
    driverName: row.driver_name,
    driverSince: row.driver_since,
    projectCode: row.project_code,
    projectName: row.project_name,
    totalKm,
    firstReading,
    lastReading,
    avgKmPerDay: daysInRange > 0 && totalKm > 0 ? Math.round(totalKm / daysInRange) : 0,
    fuelCost,
    fuelLitres,
    costPerKm: totalKm > 0 ? Math.round((fuelCost / totalKm) * 100) / 100 : null,
    litresPer100km: totalKm > 0 && fuelLitres > 0 ? Math.round((fuelLitres / totalKm) * 10000) / 100 : null,
    checkInCount,
    dailyChecks: parseInt(row.daily_checks) || 0,
    weeklyChecks: parseInt(row.weekly_checks) || 0,
    lastCheckDate: row.last_check_date,
    complianceRate: Math.min(100, Math.round((checkInCount / expectedChecks) * 100)),
    odometerReadings: parseInt(row.odo_readings) || 0,
    fuelTransactions: parseInt(row.fuel_txns) || 0,
  };
}

/**
 * Get vehicle scorecard — all vehicles with metrics for a date range
 * Uses robust first/last clean reading for KM instead of SUM(km_since_last)
 */
export async function getVehicleScorecard(
  startDate: string,
  endDate: string
): Promise<ScorecardReport> {
  const startD = new Date(startDate);
  const endD = new Date(endDate);
  const expectedChecks = countWeekdays(startD, endD);
  const daysInRange = Math.max(1, Math.ceil((endD.getTime() - startD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Robust KM: first and last CLEAN reading (excluding discrepancy-flagged)
  // This avoids inflated values from VLM misreads and Odoo bulk imports
  const rows = await sql`
    WITH clean_readings AS (
      SELECT vehicle_id, reading, recorded_at,
        ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY recorded_at ASC, reading ASC) as rn_first,
        ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY recorded_at DESC, reading DESC) as rn_last
      FROM fleet_odometer_history
      WHERE recorded_at::date >= ${startDate}::date
        AND recorded_at::date <= ${endDate}::date
        AND (discrepancy_flag IS NULL OR discrepancy_flag = false)
    )
    SELECT
      fv.id, fv.registration, fv.make, fv.model, fv.year,
      fv.vehicle_type, fv.ownership_type, fv.status,
      s.first_name || ' ' || s.last_name as driver_name,
      va.assignment_start::text as driver_since,
      p.project_code, p.project_name,
      COALESCE(first_r.reading, 0)::text as first_reading,
      COALESCE(last_r.reading, 0)::text as last_reading,
      COALESCE(odo_count.cnt, 0)::text as odo_readings,
      COALESCE(fuel.total_cost, 0)::text as fuel_cost,
      COALESCE(fuel.total_litres, 0)::text as fuel_litres,
      COALESCE(fuel.txn_count, 0)::text as fuel_txns,
      COALESCE(checks.total_checks, 0)::text as check_in_count,
      COALESCE(checks.daily_checks, 0)::text as daily_checks,
      COALESCE(checks.weekly_checks, 0)::text as weekly_checks,
      checks.last_check_date::text
    FROM fleet_vehicles fv
    LEFT JOIN vehicle_assignments va
      ON va.fleet_vehicle_id = fv.id AND va.is_active = true
    LEFT JOIN staff s ON s.id = va.staff_id
    LEFT JOIN fleet_vehicle_project_assignments fvpa
      ON fvpa.vehicle_id = fv.id AND fvpa.is_active = true
    LEFT JOIN projects p ON p.id = fvpa.project_id
    LEFT JOIN clean_readings first_r
      ON first_r.vehicle_id = fv.id AND first_r.rn_first = 1
    LEFT JOIN clean_readings last_r
      ON last_r.vehicle_id = fv.id AND last_r.rn_last = 1
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int as cnt
      FROM fleet_odometer_history
      WHERE vehicle_id = fv.id
        AND recorded_at::date >= ${startDate}::date
        AND recorded_at::date <= ${endDate}::date
    ) odo_count ON true
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(amount_rand), 0) as total_cost,
        COALESCE(SUM(litres), 0) as total_litres,
        COUNT(*)::int as txn_count
      FROM fleet_fuel_transactions
      WHERE vehicle_id = fv.id
        AND transaction_date >= ${startDate}::date
        AND transaction_date <= ${endDate}::date
    ) fuel ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int as total_checks,
        COUNT(*) FILTER (WHERE check_type = 'daily')::int as daily_checks,
        COUNT(*) FILTER (WHERE check_type = 'weekly')::int as weekly_checks,
        MAX(check_date) as last_check_date
      FROM fleet_check_records
      WHERE vehicle_id = fv.id
        AND check_date >= ${startDate}::date
        AND check_date <= ${endDate}::date
    ) checks ON true
    WHERE fv.status != 'retired'
    ORDER BY GREATEST(COALESCE(last_r.reading, 0) - COALESCE(first_r.reading, 0), 0) DESC
  ` as ScorecardRow[];

  const vehicles = rows.map(row => parseRow(row, expectedChecks, daysInRange));

  const fleetTotalKm = vehicles.reduce((s, v) => s + v.totalKm, 0);
  const fleetFuelCost = vehicles.reduce((s, v) => s + v.fuelCost, 0);
  const fleetFuelLitres = vehicles.reduce((s, v) => s + v.fuelLitres, 0);
  const totalCheckIns = vehicles.reduce((s, v) => s + v.checkInCount, 0);
  const activeWithData = vehicles.filter(v => v.totalKm > 0 || v.checkInCount > 0).length;
  const complianceRates = vehicles.filter(v => v.driverName).map(v => v.complianceRate);
  const avgCompliance = complianceRates.length > 0
    ? Math.round(complianceRates.reduce((s, r) => s + r, 0) / complianceRates.length)
    : 0;

  log.info('Vehicle scorecard generated', { startDate, endDate, vehicleCount: vehicles.length, fleetTotalKm });

  return {
    startDate,
    endDate,
    daysInRange,
    summary: {
      totalVehicles: vehicles.length,
      activeWithData,
      fleetTotalKm,
      fleetFuelCost,
      fleetFuelLitres,
      fleetAvgCostPerKm: fleetTotalKm > 0 ? Math.round((fleetFuelCost / fleetTotalKm) * 100) / 100 : null,
      fleetAvgLitresPer100km: fleetTotalKm > 0 && fleetFuelLitres > 0
        ? Math.round((fleetFuelLitres / fleetTotalKm) * 10000) / 100 : null,
      fleetAvgCompliance: avgCompliance,
      totalCheckIns,
    },
    vehicles,
    generatedAt: new Date().toISOString(),
  };
}

export const fleetScorecardService = { getVehicleScorecard };
export default fleetScorecardService;
