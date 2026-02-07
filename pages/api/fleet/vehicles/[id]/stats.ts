/**
 * Fleet Vehicle Statistics API
 * GET: Get odometer and fuel statistics for a vehicle
 * - Daily, weekly, monthly km travelled
 * - Fuel consumption patterns
 * - Check-in summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface KmStatistics {
  today: number;
  thisWeek: number;
  thisMonth: number;
  lastMonth: number;
  total: number;
  averagePerDay: number;
  readingsCount: number;
}

interface FuelStatistics {
  currentLevel: number | null;
  averageLevel: number | null;
  lowestLevel: number;
  highestLevel: number;
  readingsCount: number;
}

interface CheckInStatistics {
  totalCheckIns: number;
  thisMonth: number;
  lastCheckIn: string | null;
  passRate: number;
  criticalIssuesCount: number;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id: vehicleId, startDate, endDate } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'Unknown', ['GET']);
  }

  // Parse custom date range if provided
  const customStartDate = startDate && typeof startDate === 'string' ? startDate : null;
  const customEndDate = endDate && typeof endDate === 'string' ? endDate : null;
  const hasCustomRange = customStartDate && customEndDate;

  try {
    // Verify vehicle exists
    const vehicleCheck = await sql`
      SELECT id, registration FROM fleet_vehicles WHERE id = ${vehicleId}
    `;
    if (vehicleCheck.length === 0) {
      return apiResponse.notFound(res, 'Vehicle', vehicleId);
    }

    // Get custom date range statistics if requested
    let customRangeStats = null;
    if (hasCustomRange) {
      const customStats = await sql`
        WITH readings AS (
          SELECT
            reading,
            recorded_at::date as reading_date,
            km_since_last
          FROM fleet_odometer_history
          WHERE vehicle_id = ${vehicleId}
            AND recorded_at::date >= ${customStartDate}::date
            AND recorded_at::date <= ${customEndDate}::date
          ORDER BY recorded_at
        )
        SELECT
          COALESCE(SUM(COALESCE(km_since_last, 0)), 0) as total_km,
          COALESCE(MAX(reading), 0) as end_reading,
          COALESCE(MIN(reading), 0) as start_reading,
          COUNT(*) as readings_count,
          MIN(reading_date) as first_date,
          MAX(reading_date) as last_date
        FROM readings
      ` as Array<{
        total_km: string;
        end_reading: string;
        start_reading: string;
        readings_count: string;
        first_date: string | null;
        last_date: string | null;
      }>;

      if (customStats[0]) {
        const stats = customStats[0];
        const startReading = parseInt(stats.start_reading);
        const endReading = parseInt(stats.end_reading);
        const readingsCount = parseInt(stats.readings_count);

        // Calculate days in range for average
        const start = new Date(customStartDate);
        const end = new Date(customEndDate);
        const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

        // Use direct odometer difference for more accurate total
        const totalKm = endReading > startReading ? endReading - startReading : parseInt(stats.total_km);

        customRangeStats = {
          startDate: customStartDate,
          endDate: customEndDate,
          totalKm,
          startReading,
          endReading,
          readingsCount,
          daysInRange: daysDiff,
          averagePerDay: readingsCount > 0 ? Math.round(totalKm / daysDiff) : 0,
        };
      }
    }

    // Get odometer statistics from odometer history (the source of truth)
    const odometerStats = await sql`
      WITH readings AS (
        SELECT
          reading,
          recorded_at::date as reading_date,
          km_since_last
        FROM fleet_odometer_history
        WHERE vehicle_id = ${vehicleId}
        ORDER BY recorded_at DESC
      )
      SELECT
        COALESCE(SUM(CASE WHEN reading_date = CURRENT_DATE THEN COALESCE(km_since_last, 0) ELSE 0 END), 0) as today_km,
        COALESCE(SUM(CASE WHEN reading_date >= date_trunc('week', CURRENT_DATE) THEN COALESCE(km_since_last, 0) ELSE 0 END), 0) as week_km,
        COALESCE(SUM(CASE WHEN reading_date >= date_trunc('month', CURRENT_DATE) THEN COALESCE(km_since_last, 0) ELSE 0 END), 0) as month_km,
        COALESCE(SUM(CASE WHEN reading_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                          AND reading_date < date_trunc('month', CURRENT_DATE) THEN COALESCE(km_since_last, 0) ELSE 0 END), 0) as last_month_km,
        COALESCE(SUM(COALESCE(km_since_last, 0)), 0) as total_km,
        COALESCE(MAX(reading), 0) as latest_reading,
        COALESCE(MIN(reading), 0) as earliest_reading,
        COUNT(*) as readings_count
      FROM readings
    ` as Array<{
      today_km: string;
      week_km: string;
      month_km: string;
      last_month_km: string;
      total_km: string;
      latest_reading: string;
      earliest_reading: string;
      readings_count: string;
    }>;

    // Get fuel statistics from fuel history table
    const fuelStats = await sql`
      SELECT
        COALESCE((
          SELECT fuel_level
          FROM fleet_fuel_history
          WHERE vehicle_id = ${vehicleId}
          ORDER BY recorded_at DESC
          LIMIT 1
        ), 0) as current_level,
        COALESCE(AVG(fuel_level), 0) as avg_level,
        COALESCE(MIN(fuel_level), 0) as min_level,
        COALESCE(MAX(fuel_level), 0) as max_level,
        COUNT(*) as readings_count
      FROM fleet_fuel_history
      WHERE vehicle_id = ${vehicleId}
    ` as Array<{
      current_level: string;
      avg_level: string;
      min_level: string;
      max_level: string;
      readings_count: string;
    }>;

    // Get check-in statistics
    const checkInStats = await sql`
      SELECT
        COUNT(*) as total_check_ins,
        COUNT(*) FILTER (WHERE check_date >= date_trunc('month', CURRENT_DATE)) as this_month,
        MAX(check_date) as last_check_in,
        COUNT(*) FILTER (WHERE status = 'approved') as approved_count,
        COUNT(*) FILTER (WHERE has_critical_issues = true) as critical_issues
      FROM fleet_check_records
      WHERE vehicle_id = ${vehicleId}
    ` as Array<{
      total_check_ins: string;
      this_month: string;
      last_check_in: string | null;
      approved_count: string;
      critical_issues: string;
    }>;

    const odometerData = odometerStats[0];
    const fuelData = fuelStats[0];
    const checkInData = checkInStats[0];

    // Calculate average per day
    const readingsCount = parseInt(odometerData.readings_count);
    const totalKm = parseInt(odometerData.total_km);
    const averagePerDay = readingsCount > 1 ? Math.round(totalKm / Math.max(readingsCount - 1, 1)) : 0;

    const totalCheckIns = parseInt(checkInData.total_check_ins);
    const approvedCount = parseInt(checkInData.approved_count);
    const passRate = totalCheckIns > 0 ? Math.round((approvedCount / totalCheckIns) * 100) : 0;

    const statistics = {
      odometer: {
        today: parseInt(odometerData.today_km),
        thisWeek: parseInt(odometerData.week_km),
        thisMonth: parseInt(odometerData.month_km),
        lastMonth: parseInt(odometerData.last_month_km),
        total: totalKm,
        averagePerDay,
        latestReading: parseInt(odometerData.latest_reading),
        earliestReading: parseInt(odometerData.earliest_reading),
        readingsCount,
      } as KmStatistics & { latestReading: number; earliestReading: number },
      fuel: {
        currentLevel: parseInt(fuelData.readings_count) > 0 ? parseInt(fuelData.current_level) : null,
        averageLevel: parseInt(fuelData.readings_count) > 0 ? Math.round(parseFloat(fuelData.avg_level)) : null,
        lowestLevel: parseInt(fuelData.min_level),
        highestLevel: parseInt(fuelData.max_level),
        readingsCount: parseInt(fuelData.readings_count),
      } as FuelStatistics,
      checkIns: {
        totalCheckIns,
        thisMonth: parseInt(checkInData.this_month),
        lastCheckIn: checkInData.last_check_in,
        passRate,
        criticalIssuesCount: parseInt(checkInData.critical_issues),
      } as CheckInStatistics,
      customRange: customRangeStats,
    };

    log.info('Retrieved vehicle statistics', { vehicleId, readingsCount, hasCustomRange });

    return apiResponse.success(res, statistics);
  } catch (error) {
    log.error('Fleet stats API error', { error, vehicleId });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
