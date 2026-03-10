/**
 * Fleet Driver Score Service
 * Calculates and manages driver performance scores, leaderboards, and scorecards
 *
 * Note: Uses simplified model where fleet_vehicles.assigned_driver_id tracks current driver
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  ScorePeriod,
  DriverScore,
  LeaderboardEntry,
  Leaderboard,
  DriverScorecard,
  DriverScoreHistoryPoint,
  ScoreBreakdown,
  DriverScoreRow,
  LeaderboardRow,
} from '../types/driver-score.types';

import {
  rowToDriverScore,
  rowToLeaderboardEntry,
  calculateCompositeScore,
} from '../types/driver-score.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================================
// Score Calculation
// ============================================================================

/**
 * Calculate check-in compliance score (0-100)
 * Based on: check-in frequency, timeliness, and issue reporting
 */
async function calculateCheckInScore(
  staffId: string,
  startDate: string,
  endDate: string
): Promise<{
  score: number | null;
  totalCheckIns: number;
  expectedCheckIns: number;
  missedCheckIns: number;
  lateCheckIns: number;
  criticalIssues: number;
  minorIssues: number;
}> {
  try {
    // Get check-in stats for this driver in the period
    const stats = await sql`
      SELECT
        COUNT(*) as total_check_ins,
        COUNT(*) FILTER (WHERE check_type = 'end_of_day' AND check_time::time > '18:00:00') as late_check_ins,
        COUNT(*) FILTER (WHERE has_critical_issues = true) as critical_issues,
        COUNT(*) FILTER (WHERE has_minor_issues = true) as minor_issues
      FROM fleet_check_records
      WHERE driver_id = ${staffId}
        AND check_date >= ${startDate}::date
        AND check_date < ${endDate}::date
    `;

    // Calculate expected check-ins based on days in period (simplified)
    const periodDays = Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    const totalCheckIns = Number(stats[0]?.total_check_ins) || 0;
    const lateCheckIns = Number(stats[0]?.late_check_ins) || 0;
    const criticalIssues = Number(stats[0]?.critical_issues) || 0;
    const minorIssues = Number(stats[0]?.minor_issues) || 0;

    // Expected check-ins: 1 per weekday in the period (rough estimate)
    const expectedCheckIns = Math.max(Math.floor(periodDays * 5 / 7), 1);
    const missedCheckIns = Math.max(expectedCheckIns - totalCheckIns, 0);

    if (totalCheckIns === 0) {
      return {
        score: null, // No check-ins, no score
        totalCheckIns,
        expectedCheckIns,
        missedCheckIns,
        lateCheckIns,
        criticalIssues,
        minorIssues,
      };
    }

    // Score calculation:
    // - Base: (total / expected) * 100, capped at 100
    // - Penalty: -5 per late check-in
    // - Bonus: +2 for reporting critical issues (shows diligence)
    const baseScore = Math.min((totalCheckIns / expectedCheckIns) * 100, 100);
    const latePenalty = Math.min(lateCheckIns * 5, 30); // Max 30% penalty
    const reportingBonus = Math.min(criticalIssues * 2, 10); // Max 10% bonus

    const score = Math.max(0, Math.min(100, baseScore - latePenalty + reportingBonus));

    return {
      score: Math.round(score * 10) / 10,
      totalCheckIns,
      expectedCheckIns,
      missedCheckIns,
      lateCheckIns,
      criticalIssues,
      minorIssues,
    };
  } catch (error) {
    log.error('Failed to calculate check-in score', { error, staffId });
    return {
      score: null,
      totalCheckIns: 0,
      expectedCheckIns: 0,
      missedCheckIns: 0,
      lateCheckIns: 0,
      criticalIssues: 0,
      minorIssues: 0,
    };
  }
}

/**
 * Calculate fuel efficiency score (0-100)
 * Based on: L/100km compared to fleet average
 */
async function calculateFuelEfficiencyScore(
  staffId: string,
  _startDate: string,
  _endDate: string
): Promise<{
  score: number | null;
  avgLitresPer100km: number | null;
  fleetAvgLitresPer100km: number | null;
  totalFuelCost: number | null;
}> {
  try {
    // Get driver's vehicle
    const vehicleResult = await sql`
      SELECT id FROM fleet_vehicles WHERE assigned_driver_id = ${staffId} AND status = 'active' LIMIT 1
    `;

    if (vehicleResult.length === 0) {
      return {
        score: null,
        avgLitresPer100km: null,
        fleetAvgLitresPer100km: null,
        totalFuelCost: null,
      };
    }

    const vehicleId = vehicleResult[0]?.id;
    if (!vehicleId) {
      return {
        score: null,
        avgLitresPer100km: null,
        fleetAvgLitresPer100km: null,
        totalFuelCost: null,
      };
    }

    // Get vehicle's fuel efficiency from TCO view
    const vehicleStats = await sql`
      SELECT
        litres_per_100km,
        fuel_cost_12m
      FROM v_fleet_tco_summary
      WHERE vehicle_id = ${vehicleId}
    `;

    // Get fleet average
    const fleetAvg = await sql`
      SELECT AVG(litres_per_100km) as fleet_avg
      FROM v_fleet_tco_summary
      WHERE litres_per_100km IS NOT NULL
    `;

    const avgLitresPer100km = vehicleStats[0]?.litres_per_100km
      ? parseFloat(String(vehicleStats[0].litres_per_100km))
      : null;
    const totalFuelCost = vehicleStats[0]?.fuel_cost_12m
      ? parseFloat(String(vehicleStats[0].fuel_cost_12m))
      : null;
    const fleetAvgLitresPer100km = fleetAvg[0]?.fleet_avg
      ? parseFloat(String(fleetAvg[0].fleet_avg))
      : null;

    if (!avgLitresPer100km || !fleetAvgLitresPer100km || fleetAvgLitresPer100km === 0) {
      return {
        score: null,
        avgLitresPer100km,
        fleetAvgLitresPer100km,
        totalFuelCost,
      };
    }

    // Score: 100 if at or below fleet average, decreases as consumption increases
    const percentAboveAvg = ((avgLitresPer100km - fleetAvgLitresPer100km) / fleetAvgLitresPer100km) * 100;
    const score = Math.max(0, Math.min(100, 100 - percentAboveAvg));

    return {
      score: Math.round(score * 10) / 10,
      avgLitresPer100km: Math.round(avgLitresPer100km * 10) / 10,
      fleetAvgLitresPer100km: Math.round(fleetAvgLitresPer100km * 10) / 10,
      totalFuelCost,
    };
  } catch (error) {
    log.error('Failed to calculate fuel efficiency score', { error, staffId });
    return {
      score: null,
      avgLitresPer100km: null,
      fleetAvgLitresPer100km: null,
      totalFuelCost: null,
    };
  }
}

/**
 * Calculate authorization compliance score (0-100)
 * Based on: percentage of authorized trips vs unauthorized trips
 */
async function calculateAuthorizationScore(
  staffId: string,
  startDate: string,
  endDate: string
): Promise<{
  score: number | null;
  totalTrips: number;
  authorizedTrips: number;
  unauthorizedTrips: number;
  afterHoursTrips: number;
  weekendTrips: number;
  totalKm: number;
  unauthorizedKm: number;
}> {
  try {
    // Get driver's vehicle
    const vehicleResult = await sql`
      SELECT id FROM fleet_vehicles WHERE assigned_driver_id = ${staffId} AND status = 'active' LIMIT 1
    `;

    if (vehicleResult.length === 0) {
      return {
        score: null,
        totalTrips: 0,
        authorizedTrips: 0,
        unauthorizedTrips: 0,
        afterHoursTrips: 0,
        weekendTrips: 0,
        totalKm: 0,
        unauthorizedKm: 0,
      };
    }

    const vehicleId = vehicleResult[0]?.id;
    if (!vehicleId) {
      return {
        score: null,
        totalTrips: 0,
        authorizedTrips: 0,
        unauthorizedTrips: 0,
        afterHoursTrips: 0,
        weekendTrips: 0,
        totalKm: 0,
        unauthorizedKm: 0,
      };
    }

    // Get trip stats for this vehicle
    const tripStats = await sql`
      SELECT
        COUNT(*) as total_trips,
        COUNT(*) FILTER (WHERE classification IN ('authorized', 'home_commute')) as authorized_trips,
        COUNT(*) FILTER (WHERE classification IN ('unauthorized', 'suspicious')) as unauthorized_trips,
        COUNT(*) FILTER (WHERE EXTRACT(HOUR FROM start_time) >= 18 OR EXTRACT(HOUR FROM start_time) < 6) as after_hours_trips,
        COUNT(*) FILTER (WHERE EXTRACT(DOW FROM start_time) IN (0, 6)) as weekend_trips,
        COALESCE(SUM(distance_km), 0) as total_km,
        COALESCE(SUM(distance_km) FILTER (WHERE classification IN ('unauthorized', 'suspicious')), 0) as unauthorized_km
      FROM fleet_gps_trips
      WHERE vehicle_id = ${vehicleId}
        AND start_time >= ${startDate}::date
        AND start_time < ${endDate}::date
    `;

    const totalTrips = Number(tripStats[0]?.total_trips) || 0;
    const authorizedTrips = Number(tripStats[0]?.authorized_trips) || 0;
    const unauthorizedTrips = Number(tripStats[0]?.unauthorized_trips) || 0;
    const afterHoursTrips = Number(tripStats[0]?.after_hours_trips) || 0;
    const weekendTrips = Number(tripStats[0]?.weekend_trips) || 0;
    const totalKm = parseFloat(String(tripStats[0]?.total_km)) || 0;
    const unauthorizedKm = parseFloat(String(tripStats[0]?.unauthorized_km)) || 0;

    if (totalTrips === 0) {
      return {
        score: null,
        totalTrips,
        authorizedTrips,
        unauthorizedTrips,
        afterHoursTrips,
        weekendTrips,
        totalKm,
        unauthorizedKm,
      };
    }

    // Score: percentage of authorized trips, with penalty for after-hours and weekend use
    const authRate = (authorizedTrips / totalTrips) * 100;
    const afterHoursPenalty = Math.min((afterHoursTrips / totalTrips) * 10, 20);
    const weekendPenalty = Math.min((weekendTrips / totalTrips) * 10, 20);

    const score = Math.max(0, Math.min(100, authRate - afterHoursPenalty - weekendPenalty));

    return {
      score: Math.round(score * 10) / 10,
      totalTrips,
      authorizedTrips,
      unauthorizedTrips,
      afterHoursTrips,
      weekendTrips,
      totalKm,
      unauthorizedKm,
    };
  } catch (error) {
    log.error('Failed to calculate authorization score', { error, staffId });
    return {
      score: null,
      totalTrips: 0,
      authorizedTrips: 0,
      unauthorizedTrips: 0,
      afterHoursTrips: 0,
      weekendTrips: 0,
      totalKm: 0,
      unauthorizedKm: 0,
    };
  }
}

/**
 * Calculate vehicle care score (0-100)
 * Based on: reporting issues, cleanliness ratings, damage reports
 */
async function calculateVehicleCareScore(
  staffId: string,
  startDate: string,
  endDate: string
): Promise<{
  score: number | null;
}> {
  try {
    // Get check-in quality metrics
    const careStats = await sql`
      SELECT
        COUNT(*) as total_checks,
        AVG(CASE
          WHEN has_critical_issues = false AND has_minor_issues = false THEN 100
          WHEN has_minor_issues = true AND has_critical_issues = false THEN 70
          WHEN has_critical_issues = true THEN 40
          ELSE 50
        END) as avg_condition_score,
        COUNT(*) FILTER (WHERE has_critical_issues = true) as critical_issues
      FROM fleet_check_records
      WHERE driver_id = ${staffId}
        AND check_date >= ${startDate}::date
        AND check_date < ${endDate}::date
    `;

    const totalChecks = Number(careStats[0]?.total_checks) || 0;
    const avgConditionScore = parseFloat(String(careStats[0]?.avg_condition_score)) || null;
    const criticalIssues = Number(careStats[0]?.critical_issues) || 0;

    if (totalChecks === 0 || avgConditionScore === null) {
      return { score: null };
    }

    // Score is based on average vehicle condition
    let score = avgConditionScore;
    if (criticalIssues > 3 && totalChecks > 5) {
      const criticalRate = criticalIssues / totalChecks;
      if (criticalRate > 0.5) {
        score -= 20;
      } else if (criticalRate > 0.3) {
        score -= 10;
      }
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
    };
  } catch (error) {
    log.error('Failed to calculate vehicle care score', { error, staffId });
    return { score: null };
  }
}

// ============================================================================
// Score Management
// ============================================================================

/**
 * Calculate and store driver score for a specific period
 */
export async function calculateDriverScore(
  staffId: string,
  scoreType: ScorePeriod,
  scoreDate?: string
): Promise<DriverScore> {
  const date = scoreDate || new Date().toISOString().split('T')[0]!;

  // Determine period dates
  let startDate: string;
  let endDate: string = date;

  switch (scoreType) {
    case 'daily':
      startDate = date;
      endDate = new Date(new Date(date).getTime() + 86400000).toISOString().split('T')[0]!;
      break;
    case 'weekly':
      const weekStart = new Date(date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      startDate = weekStart.toISOString().split('T')[0]!;
      endDate = new Date(weekStart.getTime() + 7 * 86400000).toISOString().split('T')[0]!;
      break;
    case 'monthly':
    default:
      const monthStart = new Date(date);
      monthStart.setDate(1);
      startDate = monthStart.toISOString().split('T')[0]!;
      const nextMonth = new Date(monthStart);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      endDate = nextMonth.toISOString().split('T')[0]!;
      break;
  }

  try {
    // Calculate individual scores
    const [checkIn, fuelEfficiency, authorization, vehicleCare] = await Promise.all([
      calculateCheckInScore(staffId, startDate, endDate),
      calculateFuelEfficiencyScore(staffId, startDate, endDate),
      calculateAuthorizationScore(staffId, startDate, endDate),
      calculateVehicleCareScore(staffId, startDate, endDate),
    ]);

    // Calculate composite score
    const compositeScore = calculateCompositeScore(
      checkIn.score,
      fuelEfficiency.score,
      authorization.score,
      vehicleCare.score
    );

    // Upsert score record
    const result = await sql`
      INSERT INTO fleet_driver_scores (
        id, staff_id, score_date, score_type,
        check_in_compliance, fuel_efficiency_score, authorization_compliance, vehicle_care_score,
        composite_score,
        total_check_ins, expected_check_ins, missed_check_ins, late_check_ins,
        critical_issues_reported, minor_issues_reported,
        avg_litres_per_100km, fleet_avg_litres_per_100km, total_fuel_cost,
        total_trips, authorized_trips, unauthorized_trips, after_hours_trips, weekend_trips,
        total_km, unauthorized_km,
        created_at
      ) VALUES (
        gen_random_uuid(), ${staffId}, ${date}::date, ${scoreType},
        ${checkIn.score}, ${fuelEfficiency.score}, ${authorization.score}, ${vehicleCare.score},
        ${compositeScore},
        ${checkIn.totalCheckIns}, ${checkIn.expectedCheckIns}, ${checkIn.missedCheckIns}, ${checkIn.lateCheckIns},
        ${checkIn.criticalIssues}, ${checkIn.minorIssues},
        ${fuelEfficiency.avgLitresPer100km}, ${fuelEfficiency.fleetAvgLitresPer100km}, ${fuelEfficiency.totalFuelCost},
        ${authorization.totalTrips}, ${authorization.authorizedTrips}, ${authorization.unauthorizedTrips},
        ${authorization.afterHoursTrips}, ${authorization.weekendTrips},
        ${authorization.totalKm}, ${authorization.unauthorizedKm},
        NOW()
      )
      ON CONFLICT (staff_id, score_date, score_type)
      DO UPDATE SET
        check_in_compliance = EXCLUDED.check_in_compliance,
        fuel_efficiency_score = EXCLUDED.fuel_efficiency_score,
        authorization_compliance = EXCLUDED.authorization_compliance,
        vehicle_care_score = EXCLUDED.vehicle_care_score,
        composite_score = EXCLUDED.composite_score,
        total_check_ins = EXCLUDED.total_check_ins,
        expected_check_ins = EXCLUDED.expected_check_ins,
        missed_check_ins = EXCLUDED.missed_check_ins,
        late_check_ins = EXCLUDED.late_check_ins,
        critical_issues_reported = EXCLUDED.critical_issues_reported,
        minor_issues_reported = EXCLUDED.minor_issues_reported,
        avg_litres_per_100km = EXCLUDED.avg_litres_per_100km,
        fleet_avg_litres_per_100km = EXCLUDED.fleet_avg_litres_per_100km,
        total_fuel_cost = EXCLUDED.total_fuel_cost,
        total_trips = EXCLUDED.total_trips,
        authorized_trips = EXCLUDED.authorized_trips,
        unauthorized_trips = EXCLUDED.unauthorized_trips,
        after_hours_trips = EXCLUDED.after_hours_trips,
        weekend_trips = EXCLUDED.weekend_trips,
        total_km = EXCLUDED.total_km,
        unauthorized_km = EXCLUDED.unauthorized_km,
        created_at = NOW()
      RETURNING *
    `;

    const row = result[0] as DriverScoreRow;
    return rowToDriverScore(row);
  } catch (error) {
    log.error('Failed to calculate driver score', { error, staffId, scoreType, scoreDate });
    throw error;
  }
}

/**
 * Calculate scores for all drivers with assigned vehicles
 */
export async function calculateAllDriverScores(
  scoreType: ScorePeriod,
  scoreDate?: string
): Promise<DriverScore[]> {
  try {
    // Get all drivers with currently assigned vehicles
    const drivers = await sql`
      SELECT DISTINCT fv.assigned_driver_id as staff_id
      FROM fleet_vehicles fv
      WHERE fv.assigned_driver_id IS NOT NULL
        AND fv.status = 'active'
    `;

    const scores: DriverScore[] = [];
    for (const driver of drivers) {
      try {
        const score = await calculateDriverScore(driver.staff_id, scoreType, scoreDate);
        scores.push(score);
      } catch (err) {
        log.warn('Failed to calculate score for driver', { staffId: driver.staff_id, error: err });
      }
    }

    log.info('Calculated driver scores', { count: scores.length, scoreType, scoreDate });
    return scores;
  } catch (error) {
    log.error('Failed to calculate all driver scores', { error, scoreType, scoreDate });
    throw error;
  }
}

// ============================================================================
// Leaderboard
// ============================================================================

/**
 * Get driver leaderboard
 */
export async function getLeaderboard(
  period: ScorePeriod = 'monthly',
  limit: number = 20
): Promise<Leaderboard> {
  try {
    // Get the most recent score date for this period
    const latestDate = await sql`
      SELECT MAX(score_date) as latest_date
      FROM fleet_driver_scores
      WHERE score_type = ${period}
    `;

    const scoreDate = latestDate[0]?.latest_date;
    if (!scoreDate) {
      return {
        period,
        scoreDate: new Date().toISOString().split('T')[0]!,
        generatedAt: new Date().toISOString(),
        totalDrivers: 0,
        entries: [],
      };
    }

    // Get leaderboard with driver details
    const rows = await sql`
      SELECT
        ds.*,
        s.first_name || ' ' || s.last_name as driver_name,
        s.phone,
        s.email,
        RANK() OVER (ORDER BY ds.composite_score DESC NULLS LAST) as rank
      FROM fleet_driver_scores ds
      JOIN staff s ON ds.staff_id = s.id
      WHERE ds.score_date = ${scoreDate}
        AND ds.score_type = ${period}
        AND ds.composite_score IS NOT NULL
      ORDER BY ds.composite_score DESC NULLS LAST
      LIMIT ${limit}
    `;

    const entries: LeaderboardEntry[] = (rows as LeaderboardRow[]).map(rowToLeaderboardEntry);

    // Get total count
    const countResult = await sql`
      SELECT COUNT(*) as total
      FROM fleet_driver_scores
      WHERE score_date = ${scoreDate}
        AND score_type = ${period}
        AND composite_score IS NOT NULL
    `;

    return {
      period,
      scoreDate,
      generatedAt: new Date().toISOString(),
      totalDrivers: Number(countResult[0]?.total) || 0,
      entries,
    };
  } catch (error) {
    log.error('Failed to get leaderboard', { error, period });
    throw error;
  }
}

// ============================================================================
// Driver Scorecard
// ============================================================================

/**
 * Get detailed scorecard for a specific driver
 */
export async function getDriverScorecard(
  staffId: string,
  period: ScorePeriod = 'monthly',
  historyMonths: number = 6
): Promise<DriverScorecard> {
  try {
    // Get driver info
    const driverInfo = await sql`
      SELECT
        id,
        first_name || ' ' || last_name as name,
        phone,
        email
      FROM staff
      WHERE id = ${staffId}
    `;

    if (driverInfo.length === 0) {
      throw new Error('Driver not found');
    }

    const driver = driverInfo[0];

    // Get current score
    const currentScoreResult = await sql`
      SELECT *
      FROM fleet_driver_scores
      WHERE staff_id = ${staffId}
        AND score_type = ${period}
      ORDER BY score_date DESC
      LIMIT 1
    `;

    const currentScore = currentScoreResult.length > 0
      ? rowToDriverScore(currentScoreResult[0] as DriverScoreRow)
      : null;

    // Get rank
    let currentRank: number | null = null;
    let totalDrivers = 0;
    if (currentScore?.scoreDate) {
      const rankResult = await sql`
        WITH ranked AS (
          SELECT
            staff_id,
            RANK() OVER (ORDER BY composite_score DESC NULLS LAST) as rank,
            COUNT(*) OVER () as total
          FROM fleet_driver_scores
          WHERE score_date = ${currentScore.scoreDate}
            AND score_type = ${period}
            AND composite_score IS NOT NULL
        )
        SELECT rank, total FROM ranked WHERE staff_id = ${staffId}
      `;
      currentRank = Number(rankResult[0]?.rank) || null;
      totalDrivers = Number(rankResult[0]?.total) || 0;
    }

    // Get score history
    const historyStartDate = new Date();
    historyStartDate.setMonth(historyStartDate.getMonth() - historyMonths);

    const historyResult = await sql`
      SELECT
        ds.score_date,
        ds.score_type,
        ds.composite_score,
        ds.check_in_compliance,
        ds.fuel_efficiency_score,
        ds.authorization_compliance,
        ds.vehicle_care_score
      FROM fleet_driver_scores ds
      WHERE ds.staff_id = ${staffId}
        AND ds.score_type = ${period}
        AND ds.score_date >= ${historyStartDate.toISOString().split('T')[0]}
      ORDER BY ds.score_date DESC
    `;

    const scoreHistory: DriverScoreHistoryPoint[] = historyResult.map((row: Record<string, unknown>) => ({
      scoreDate: String(row.score_date),
      scoreType: row.score_type as ScorePeriod,
      compositeScore: row.composite_score ? parseFloat(String(row.composite_score)) : null,
      checkInCompliance: row.check_in_compliance ? parseFloat(String(row.check_in_compliance)) : null,
      fuelEfficiencyScore: row.fuel_efficiency_score ? parseFloat(String(row.fuel_efficiency_score)) : null,
      authorizationCompliance: row.authorization_compliance ? parseFloat(String(row.authorization_compliance)) : null,
      vehicleCareScore: row.vehicle_care_score ? parseFloat(String(row.vehicle_care_score)) : null,
      rank: null,
    }));

    // Get assigned vehicle
    const vehicleResult = await sql`
      SELECT
        id as vehicle_id,
        registration,
        make,
        model
      FROM fleet_vehicles
      WHERE assigned_driver_id = ${staffId}
        AND status = 'active'
      LIMIT 1
    `;

    const vehicleRow = vehicleResult[0];
    const assignedVehicle = vehicleRow
      ? {
          vehicleId: String(vehicleRow.vehicle_id || ''),
          registration: String(vehicleRow.registration || ''),
          make: vehicleRow.make ? String(vehicleRow.make) : null,
          model: vehicleRow.model ? String(vehicleRow.model) : null,
          assignedDate: '', // No assignment date in simplified model
        }
      : null;

    // Build score breakdown
    const breakdown = {
      checkIn: {
        score: currentScore?.checkInCompliance ?? null,
        label: 'Check-in Compliance',
        description: 'Based on check-in frequency, timeliness, and issue reporting',
        metrics: {
          totalCheckIns: currentScore?.totalCheckIns ?? 0,
          expectedCheckIns: currentScore?.expectedCheckIns ?? 0,
          missedCheckIns: currentScore?.missedCheckIns ?? 0,
          lateCheckIns: currentScore?.lateCheckIns ?? 0,
        },
        trend: calculateTrend(scoreHistory, 'checkInCompliance'),
        trendValue: calculateTrendValue(scoreHistory, 'checkInCompliance'),
      } as ScoreBreakdown,
      fuelEfficiency: {
        score: currentScore?.fuelEfficiencyScore ?? null,
        label: 'Fuel Efficiency',
        description: 'Based on L/100km compared to fleet average',
        metrics: {
          avgLitresPer100km: currentScore?.avgLitresPer100km ?? 'N/A',
          fleetAvgLitresPer100km: currentScore?.fleetAvgLitresPer100km ?? 'N/A',
          totalFuelCost: currentScore?.totalFuelCost ?? 0,
        },
        trend: calculateTrend(scoreHistory, 'fuelEfficiencyScore'),
        trendValue: calculateTrendValue(scoreHistory, 'fuelEfficiencyScore'),
      } as ScoreBreakdown,
      authorization: {
        score: currentScore?.authorizationCompliance ?? null,
        label: 'Authorization Compliance',
        description: 'Based on trip authorization and after-hours usage',
        metrics: {
          totalTrips: currentScore?.totalTrips ?? 0,
          authorizedTrips: currentScore?.authorizedTrips ?? 0,
          unauthorizedTrips: currentScore?.unauthorizedTrips ?? 0,
          afterHoursTrips: currentScore?.afterHoursTrips ?? 0,
        },
        trend: calculateTrend(scoreHistory, 'authorizationCompliance'),
        trendValue: calculateTrendValue(scoreHistory, 'authorizationCompliance'),
      } as ScoreBreakdown,
      vehicleCare: {
        score: currentScore?.vehicleCareScore ?? null,
        label: 'Vehicle Care',
        description: 'Based on vehicle condition from check-ins',
        metrics: {
          criticalIssuesReported: currentScore?.criticalIssuesReported ?? 0,
          minorIssuesReported: currentScore?.minorIssuesReported ?? 0,
        },
        trend: calculateTrend(scoreHistory, 'vehicleCareScore'),
        trendValue: calculateTrendValue(scoreHistory, 'vehicleCareScore'),
      } as ScoreBreakdown,
    };

    return {
      staffId,
      driverName: String(driver.name || ''),
      driverPhone: driver.phone ? String(driver.phone) : null,
      driverEmail: driver.email ? String(driver.email) : null,
      currentScore,
      currentRank,
      totalDrivers,
      scoreHistory,
      breakdown,
      assignedVehicle,
      achievements: [],
    };
  } catch (error) {
    log.error('Failed to get driver scorecard', { error, staffId });
    throw error;
  }
}

// Helper functions for trend calculation
function calculateTrend(
  history: DriverScoreHistoryPoint[],
  field: keyof DriverScoreHistoryPoint
): 'up' | 'down' | 'flat' | null {
  if (history.length < 2) return null;
  const current = history[0]?.[field];
  const previous = history[1]?.[field];
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  const diff = (current as number) - (previous as number);
  if (Math.abs(diff) < 1) return 'flat';
  return diff > 0 ? 'up' : 'down';
}

function calculateTrendValue(
  history: DriverScoreHistoryPoint[],
  field: keyof DriverScoreHistoryPoint
): number | null {
  if (history.length < 2) return null;
  const current = history[0]?.[field];
  const previous = history[1]?.[field];
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  return Math.round(((current as number) - (previous as number)) * 10) / 10;
}

// ============================================================================
// Exports
// ============================================================================

export const driverScoreService = {
  calculateDriverScore,
  calculateAllDriverScores,
  getLeaderboard,
  getDriverScorecard,
};

export default driverScoreService;
