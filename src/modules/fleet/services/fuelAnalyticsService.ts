/**
 * Fleet Fuel Analytics Service
 * Fuel consumption tracking, cost analysis, and anomaly detection
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import type {
  FuelTransactionWithVehicle,
  FuelAnomalyWithVehicle,
  FleetFuelSummary,
  VehicleFuelStats,
  FuelEfficiencyTrend,
  FuelCostBreakdown,
  AnomalyDetectionResult,
  DetectedAnomaly,
  AnomalyThresholds,
  AnomalySeverity,
  AnomalyStatus,
  FuelTransactionRow,
  FuelAnomalyRow,
} from '../types/fuel-analytics.types';

import {
  rowToFuelTransaction,
  rowToFuelAnomaly,
} from '../types/fuel-analytics.types';

const sql = neon(process.env.DATABASE_URL!);

// Default thresholds for anomaly detection
const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  highConsumptionPercentage: 30,  // 30% above average
  lowConsumptionPercentage: 30,   // 30% below average
  suddenDropLitres: 20,           // 20L sudden drop
  priceDeviationPercentage: 15,   // 15% from market average
  frequentFillDays: 3,            // fills within 3 days
  frequentFillCount: 3,           // more than 3 fills
};

// ============================================================================
// Fuel Transactions
// ============================================================================

/**
 * Get fuel transactions with optional filters
 * Uses explicit query branches — sql.unsafe() is not available on the Neon HTTP driver
 */
export async function getFuelTransactions(options: {
  vehicleId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ transactions: FuelTransactionWithVehicle[]; total: number }> {
  const { vehicleId, startDate, endDate, limit = 50, offset = 0 } = options;

  try {
    let rows: FuelTransactionRow[];
    let countResult: Record<string, unknown>[];

    if (vehicleId && startDate && endDate) {
      rows = await sql`
        SELECT ft.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_transactions ft
        JOIN fleet_vehicles fv ON ft.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE ft.vehicle_id = ${vehicleId}
          AND ft.transaction_date >= ${startDate}::date
          AND ft.transaction_date <= ${endDate}::date
        ORDER BY ft.transaction_date DESC, ft.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      ` as FuelTransactionRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_transactions ft
        WHERE ft.vehicle_id = ${vehicleId}
          AND ft.transaction_date >= ${startDate}::date
          AND ft.transaction_date <= ${endDate}::date
      `;
    } else if (vehicleId) {
      rows = await sql`
        SELECT ft.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_transactions ft
        JOIN fleet_vehicles fv ON ft.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE ft.vehicle_id = ${vehicleId}
        ORDER BY ft.transaction_date DESC, ft.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      ` as FuelTransactionRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_transactions ft
        WHERE ft.vehicle_id = ${vehicleId}
      `;
    } else if (startDate && endDate) {
      rows = await sql`
        SELECT ft.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_transactions ft
        JOIN fleet_vehicles fv ON ft.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE ft.transaction_date >= ${startDate}::date
          AND ft.transaction_date <= ${endDate}::date
        ORDER BY ft.transaction_date DESC, ft.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      ` as FuelTransactionRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_transactions ft
        WHERE ft.transaction_date >= ${startDate}::date
          AND ft.transaction_date <= ${endDate}::date
      `;
    } else {
      rows = await sql`
        SELECT ft.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_transactions ft
        JOIN fleet_vehicles fv ON ft.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        ORDER BY ft.transaction_date DESC, ft.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      ` as FuelTransactionRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_transactions ft
      `;
    }

    return {
      transactions: rows.map(rowToFuelTransaction),
      total: Number(countResult[0]?.total) || 0,
    };
  } catch (error) {
    log.error('Failed to get fuel transactions', { error, options });
    throw error;
  }
}

// ============================================================================
// Fleet Fuel Summary
// ============================================================================

/**
 * Get fleet-wide fuel summary
 */
export async function getFleetFuelSummary(
  period: 'week' | 'month' | 'quarter' | 'year' = 'month'
): Promise<FleetFuelSummary> {
  try {
    // Calculate period dates
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Get current period stats
    const currentStats = await sql`
      SELECT
        COUNT(DISTINCT ft.vehicle_id) as vehicles_with_data,
        COALESCE(SUM(ft.litres), 0) as total_litres,
        COALESCE(SUM(ft.amount_rand), 0) as total_cost,
        COALESCE(AVG(ft.litres_per_100km), 0) as avg_efficiency,
        COALESCE(MIN(ft.litres_per_100km), 0) as best_efficiency,
        COALESCE(MAX(ft.litres_per_100km), 0) as worst_efficiency,
        COALESCE(AVG(ft.price_per_litre), 0) as avg_price,
        COALESCE(SUM(ft.km_since_last_fill), 0) as total_km
      FROM fleet_fuel_transactions ft
      WHERE ft.transaction_date >= ${startStr}::date
        AND ft.transaction_date <= ${endStr}::date
    `;

    // Get total vehicles
    const vehicleCount = await sql`
      SELECT COUNT(*) as total FROM fleet_vehicles WHERE status = 'active'
    `;

    // Get anomaly counts
    const anomalyStats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'dismissed')) as unresolved,
        COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('resolved', 'dismissed')) as critical
      FROM fleet_fuel_anomalies
      WHERE detected_at >= ${startStr}::date
    `;

    // Get previous period for trends
    const prevEndDate = new Date(startDate);
    prevEndDate.setDate(prevEndDate.getDate() - 1);
    const prevStartDate = new Date(prevEndDate);
    switch (period) {
      case 'week':
        prevStartDate.setDate(prevStartDate.getDate() - 7);
        break;
      case 'month':
        prevStartDate.setMonth(prevStartDate.getMonth() - 1);
        break;
      case 'quarter':
        prevStartDate.setMonth(prevStartDate.getMonth() - 3);
        break;
      case 'year':
        prevStartDate.setFullYear(prevStartDate.getFullYear() - 1);
        break;
    }

    const prevStats = await sql`
      SELECT
        COALESCE(SUM(ft.amount_rand), 0) as total_cost,
        COALESCE(AVG(ft.litres_per_100km), 0) as avg_efficiency
      FROM fleet_fuel_transactions ft
      WHERE ft.transaction_date >= ${prevStartDate.toISOString().split('T')[0]}::date
        AND ft.transaction_date <= ${prevEndDate.toISOString().split('T')[0]}::date
    `;

    const stats = currentStats[0] || {};
    const prev = prevStats[0] || {};
    const anomalies = anomalyStats[0] || {};

    const totalCost = parseFloat(String(stats.total_cost)) || 0;
    const prevCost = parseFloat(String(prev.total_cost)) || 0;
    const avgEfficiency = parseFloat(String(stats.avg_efficiency)) || 0;
    const prevEfficiency = parseFloat(String(prev.avg_efficiency)) || 0;
    const totalKm = parseFloat(String(stats.total_km)) || 0;

    // Calculate trends
    const costTrendValue = prevCost > 0 ? ((totalCost - prevCost) / prevCost) * 100 : null;
    const effTrendValue = prevEfficiency > 0 ? ((avgEfficiency - prevEfficiency) / prevEfficiency) * 100 : null;

    return {
      period,
      totalVehicles: Number(vehicleCount[0]?.total) || 0,
      vehiclesWithFuelData: Number(stats.vehicles_with_data) || 0,
      totalLitres: parseFloat(String(stats.total_litres)) || 0,
      totalCost,
      avgLitresPer100km: avgEfficiency,
      bestLitresPer100km: parseFloat(String(stats.best_efficiency)) || 0,
      worstLitresPer100km: parseFloat(String(stats.worst_efficiency)) || 0,
      avgCostPerKm: totalKm > 0 ? totalCost / totalKm : 0,
      avgPricePerLitre: parseFloat(String(stats.avg_price)) || 0,
      totalKmDriven: totalKm,
      costTrend: costTrendValue === null ? 'flat' : costTrendValue > 2 ? 'up' : costTrendValue < -2 ? 'down' : 'flat',
      costTrendValue,
      efficiencyTrend: effTrendValue === null ? 'flat' : effTrendValue > 2 ? 'up' : effTrendValue < -2 ? 'down' : 'flat',
      efficiencyTrendValue: effTrendValue,
      totalAnomalies: Number(anomalies.total) || 0,
      unresolvedAnomalies: Number(anomalies.unresolved) || 0,
      criticalAnomalies: Number(anomalies.critical) || 0,
    };
  } catch (error) {
    log.error('Failed to get fleet fuel summary', { error, period });
    throw error;
  }
}

// ============================================================================
// Vehicle Fuel Stats
// ============================================================================

/**
 * Get fuel stats for all vehicles, ranked by efficiency
 */
export async function getVehicleFuelStats(
  period: 'month' | 'quarter' | 'year' = 'month',
  limit: number = 20
): Promise<VehicleFuelStats[]> {
  try {
    const startDate = new Date();
    switch (period) {
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const rows = await sql`
      WITH vehicle_stats AS (
        SELECT
          fv.id as vehicle_id,
          fv.registration,
          fv.make,
          fv.model,
          s.first_name || ' ' || s.last_name as driver_name,
          COALESCE(SUM(ft.litres), 0) as total_litres,
          COALESCE(SUM(ft.amount_rand), 0) as total_cost,
          COALESCE(SUM(ft.km_since_last_fill), 0) as total_km,
          COALESCE(AVG(ft.litres_per_100km), 0) as avg_efficiency,
          COUNT(ft.id) as fill_count,
          MAX(ft.transaction_date) as last_fill_date,
          (SELECT litres FROM fleet_fuel_transactions WHERE vehicle_id = fv.id ORDER BY transaction_date DESC LIMIT 1) as last_fill_litres
        FROM fleet_vehicles fv
        LEFT JOIN fleet_fuel_transactions ft ON fv.id = ft.vehicle_id
          AND ft.transaction_date >= ${startDate.toISOString().split('T')[0]}::date
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE fv.status = 'active'
        GROUP BY fv.id, fv.registration, fv.make, fv.model, s.first_name, s.last_name
        HAVING COUNT(ft.id) > 0
      ),
      fleet_avg AS (
        SELECT AVG(avg_efficiency) as fleet_avg FROM vehicle_stats WHERE avg_efficiency > 0
      ),
      ranked AS (
        SELECT
          vs.*,
          fa.fleet_avg,
          RANK() OVER (ORDER BY vs.avg_efficiency ASC) as efficiency_rank,
          PERCENT_RANK() OVER (ORDER BY vs.avg_efficiency ASC) as efficiency_percentile
        FROM vehicle_stats vs
        CROSS JOIN fleet_avg fa
      )
      SELECT * FROM ranked
      ORDER BY avg_efficiency ASC
      LIMIT ${limit}
    `;

    return rows.map((row: Record<string, unknown>) => ({
      vehicleId: String(row.vehicle_id),
      registration: String(row.registration),
      make: row.make ? String(row.make) : null,
      model: row.model ? String(row.model) : null,
      driverName: row.driver_name ? String(row.driver_name) : null,
      totalLitres: parseFloat(String(row.total_litres)) || 0,
      totalCost: parseFloat(String(row.total_cost)) || 0,
      totalKm: parseFloat(String(row.total_km)) || 0,
      avgLitresPer100km: parseFloat(String(row.avg_efficiency)) || 0,
      efficiencyRank: Number(row.efficiency_rank) || 0,
      efficiencyPercentile: Math.round((parseFloat(String(row.efficiency_percentile)) || 0) * 100),
      costPerKm: parseFloat(String(row.total_km)) > 0
        ? parseFloat(String(row.total_cost)) / parseFloat(String(row.total_km))
        : 0,
      monthlyAvgCost: parseFloat(String(row.total_cost)) || 0,
      vsFleetAvg: row.fleet_avg && parseFloat(String(row.fleet_avg)) > 0
        ? ((parseFloat(String(row.avg_efficiency)) - parseFloat(String(row.fleet_avg))) / parseFloat(String(row.fleet_avg))) * 100
        : 0,
      lastFillDate: row.last_fill_date ? String(row.last_fill_date) : null,
      lastFillLitres: row.last_fill_litres ? parseFloat(String(row.last_fill_litres)) : null,
      fillCount: Number(row.fill_count) || 0,
    }));
  } catch (error) {
    log.error('Failed to get vehicle fuel stats', { error, period });
    throw error;
  }
}

// ============================================================================
// Fuel Efficiency Trends
// ============================================================================

/**
 * Get fuel efficiency trends over time
 */
export async function getFuelEfficiencyTrends(
  period: 'week' | 'month' | 'quarter' = 'month',
  vehicleId?: string
): Promise<FuelEfficiencyTrend[]> {
  try {
    const startDate = new Date();
    let groupBy = 'day';

    switch (period) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        groupBy = 'day';
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        groupBy = 'day';
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        groupBy = 'week';
        break;
    }

    const startDateStr = startDate.toISOString().split('T')[0];

    const rows = vehicleId
      ? await sql`
          SELECT
            DATE_TRUNC(${groupBy}, ft.transaction_date) as date,
            AVG(ft.litres_per_100km) as avg_efficiency,
            SUM(ft.litres) as total_litres,
            SUM(ft.amount_rand) as total_cost,
            COUNT(*) as transaction_count
          FROM fleet_fuel_transactions ft
          WHERE ft.transaction_date >= ${startDateStr}::date
            AND ft.vehicle_id = ${vehicleId}
            AND ft.litres_per_100km IS NOT NULL
          GROUP BY DATE_TRUNC(${groupBy}, ft.transaction_date)
          ORDER BY date ASC
        `
      : await sql`
          SELECT
            DATE_TRUNC(${groupBy}, ft.transaction_date) as date,
            AVG(ft.litres_per_100km) as avg_efficiency,
            SUM(ft.litres) as total_litres,
            SUM(ft.amount_rand) as total_cost,
            COUNT(*) as transaction_count
          FROM fleet_fuel_transactions ft
          WHERE ft.transaction_date >= ${startDateStr}::date
            AND ft.litres_per_100km IS NOT NULL
          GROUP BY DATE_TRUNC(${groupBy}, ft.transaction_date)
          ORDER BY date ASC
        `;

    return rows.map((row: Record<string, unknown>) => ({
      date: String(row.date),
      avgLitresPer100km: parseFloat(String(row.avg_efficiency)) || 0,
      totalLitres: parseFloat(String(row.total_litres)) || 0,
      totalCost: parseFloat(String(row.total_cost)) || 0,
      transactionCount: Number(row.transaction_count) || 0,
    }));
  } catch (error) {
    log.error('Failed to get fuel efficiency trends', { error, period, vehicleId });
    throw error;
  }
}

// ============================================================================
// Fuel Cost Breakdown
// ============================================================================

/**
 * Get fuel cost breakdown by vehicle
 */
export async function getFuelCostBreakdown(
  period: 'month' | 'quarter' | 'year' = 'month'
): Promise<FuelCostBreakdown[]> {
  try {
    const startDate = new Date();
    switch (period) {
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
    }

    const rows = await sql`
      WITH totals AS (
        SELECT SUM(amount_rand) as fleet_total
        FROM fleet_fuel_transactions
        WHERE transaction_date >= ${startDate.toISOString().split('T')[0]}::date
      )
      SELECT
        fv.id as vehicle_id,
        fv.registration,
        fv.make,
        fv.model,
        COALESCE(SUM(ft.amount_rand), 0) as total_cost,
        COALESCE(SUM(ft.km_since_last_fill), 0) as total_km,
        COALESCE(AVG(ft.litres_per_100km), 0) as avg_efficiency,
        t.fleet_total
      FROM fleet_vehicles fv
      LEFT JOIN fleet_fuel_transactions ft ON fv.id = ft.vehicle_id
        AND ft.transaction_date >= ${startDate.toISOString().split('T')[0]}::date
      CROSS JOIN totals t
      WHERE fv.status = 'active'
      GROUP BY fv.id, fv.registration, fv.make, fv.model, t.fleet_total
      HAVING SUM(ft.amount_rand) > 0
      ORDER BY total_cost DESC
    `;

    return rows.map((row: Record<string, unknown>) => {
      const totalCost = parseFloat(String(row.total_cost)) || 0;
      const fleetTotal = parseFloat(String(row.fleet_total)) || 1;
      const totalKm = parseFloat(String(row.total_km)) || 0;

      return {
        vehicleId: String(row.vehicle_id),
        registration: String(row.registration),
        make: row.make ? String(row.make) : null,
        model: row.model ? String(row.model) : null,
        totalCost,
        percentageOfFleet: (totalCost / fleetTotal) * 100,
        costPerKm: totalKm > 0 ? totalCost / totalKm : 0,
        litresPer100km: parseFloat(String(row.avg_efficiency)) || 0,
      };
    });
  } catch (error) {
    log.error('Failed to get fuel cost breakdown', { error, period });
    throw error;
  }
}

// ============================================================================
// Anomaly Detection
// ============================================================================

/**
 * Run anomaly detection on fuel data
 */
export async function runAnomalyDetection(options: {
  vehicleId?: string;
  lookbackDays?: number;
  thresholds?: Partial<AnomalyThresholds>;
} = {}): Promise<AnomalyDetectionResult> {
  const {
    vehicleId,
    lookbackDays = 30,
    thresholds = {},
  } = options;

  const config = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const detected: DetectedAnomaly[] = [];
  let vehiclesChecked = 0;
  let transactionsAnalyzed = 0;

  try {
    // Get vehicles to check
    const startDateStr = startDate.toISOString().split('T')[0];
    const vehicles = vehicleId
      ? await sql`
          SELECT DISTINCT fv.id, fv.registration
          FROM fleet_vehicles fv
          JOIN fleet_fuel_transactions ft ON fv.id = ft.vehicle_id
          WHERE fv.status = 'active'
            AND fv.id = ${vehicleId}
            AND ft.transaction_date >= ${startDateStr}::date
        `
      : await sql`
          SELECT DISTINCT fv.id, fv.registration
          FROM fleet_vehicles fv
          JOIN fleet_fuel_transactions ft ON fv.id = ft.vehicle_id
          WHERE fv.status = 'active'
            AND ft.transaction_date >= ${startDateStr}::date
        `;

    vehiclesChecked = vehicles.length;

    for (const vehicle of vehicles) {
      // Get transactions for this vehicle
      const transactions = await sql`
        SELECT *
        FROM fleet_fuel_transactions
        WHERE vehicle_id = ${vehicle.id}
          AND transaction_date >= ${startDate.toISOString().split('T')[0]}::date
        ORDER BY transaction_date ASC
      `;

      transactionsAnalyzed += transactions.length;

      // Get vehicle's average efficiency
      const avgResult = await sql`
        SELECT AVG(litres_per_100km) as avg_efficiency
        FROM fleet_fuel_transactions
        WHERE vehicle_id = ${vehicle.id}
          AND litres_per_100km IS NOT NULL
      `;
      const vehicleAvg = parseFloat(String(avgResult[0]?.avg_efficiency)) || 0;

      // Check each transaction for anomalies
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        if (!tx) continue;
        const efficiency = parseFloat(String(tx.litres_per_100km)) || 0;
        const pricePerLitre = parseFloat(String(tx.price_per_litre)) || 0;

        // High consumption check
        if (vehicleAvg > 0 && efficiency > 0) {
          const deviation = ((efficiency - vehicleAvg) / vehicleAvg) * 100;
          if (deviation > config.highConsumptionPercentage) {
            detected.push({
              vehicleId: String(vehicle.id),
              registration: String(vehicle.registration),
              anomalyType: 'high_consumption',
              severity: deviation > 50 ? 'high' : 'medium',
              description: `Fuel consumption ${deviation.toFixed(0)}% higher than vehicle average`,
              evidence: {
                actual: efficiency,
                expected: vehicleAvg,
                deviation: deviation,
                transactionId: tx.id,
              },
              suggestedAction: 'Investigate driving behavior or vehicle maintenance issues',
            });
          }
        }

        // Low consumption check (potential odometer tampering)
        if (vehicleAvg > 0 && efficiency > 0 && efficiency < vehicleAvg) {
          const deviation = ((vehicleAvg - efficiency) / vehicleAvg) * 100;
          if (deviation > config.lowConsumptionPercentage) {
            detected.push({
              vehicleId: String(vehicle.id),
              registration: String(vehicle.registration),
              anomalyType: 'low_consumption',
              severity: 'high',
              description: `Fuel consumption ${deviation.toFixed(0)}% lower than average - possible odometer tampering`,
              evidence: {
                actual: efficiency,
                expected: vehicleAvg,
                deviation: -deviation,
                transactionId: tx.id,
              },
              suggestedAction: 'Verify odometer reading and investigate potential tampering',
            });
          }
        }

        // Price anomaly check (compare to market average ~R23/L)
        const marketAvg = 23.0; // Approximate SA fuel price
        if (pricePerLitre > 0) {
          const priceDeviation = Math.abs((pricePerLitre - marketAvg) / marketAvg) * 100;
          if (priceDeviation > config.priceDeviationPercentage) {
            detected.push({
              vehicleId: String(vehicle.id),
              registration: String(vehicle.registration),
              anomalyType: 'price_anomaly',
              severity: priceDeviation > 30 ? 'medium' : 'low',
              description: `Fuel price R${pricePerLitre.toFixed(2)}/L is ${priceDeviation.toFixed(0)}% ${pricePerLitre > marketAvg ? 'above' : 'below'} market average`,
              evidence: {
                actualPrice: pricePerLitre,
                marketAvg: marketAvg,
                deviation: priceDeviation,
                transactionId: tx.id,
              },
              suggestedAction: 'Verify receipt and station pricing',
            });
          }
        }

        // Frequent fills check
        if (i >= config.frequentFillCount - 1) {
          const recentFills = transactions.slice(Math.max(0, i - config.frequentFillCount + 1), i + 1);
          const firstDate = new Date(recentFills[0]!.transaction_date);
          const lastDate = new Date(recentFills[recentFills.length - 1]!.transaction_date);
          const daysDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);

          if (daysDiff <= config.frequentFillDays) {
            detected.push({
              vehicleId: String(vehicle.id),
              registration: String(vehicle.registration),
              anomalyType: 'frequent_fills',
              severity: 'medium',
              description: `${config.frequentFillCount} fuel fills within ${daysDiff.toFixed(0)} days`,
              evidence: {
                fillCount: config.frequentFillCount,
                days: daysDiff,
                firstDate: recentFills[0]!.transaction_date,
                lastDate: recentFills[recentFills.length - 1]!.transaction_date,
              },
              suggestedAction: 'Review fill pattern and verify legitimate usage',
            });
          }
        }
      }
    }

    // Store detected anomalies
    for (const anomaly of detected) {
      await sql`
        INSERT INTO fleet_fuel_anomalies (
          id, vehicle_id, detected_at, anomaly_type, severity,
          expected_consumption, actual_consumption, deviation_percentage,
          related_transaction_id, status, created_at
        ) VALUES (
          gen_random_uuid(),
          ${anomaly.vehicleId},
          NOW(),
          ${anomaly.anomalyType},
          ${anomaly.severity},
          ${anomaly.evidence.expected as number | null},
          ${anomaly.evidence.actual as number | null},
          ${anomaly.evidence.deviation as number | null},
          ${anomaly.evidence.transactionId as string | null},
          'detected',
          NOW()
        )
        ON CONFLICT DO NOTHING
      `;
    }

    log.info('Anomaly detection completed', {
      vehiclesChecked,
      transactionsAnalyzed,
      anomaliesDetected: detected.length,
    });

    return {
      detected: detected.length > 0,
      anomalies: detected,
      vehiclesChecked,
      transactionsAnalyzed,
    };
  } catch (error) {
    log.error('Failed to run anomaly detection', { error, options });
    throw error;
  }
}

// ============================================================================
// Anomaly Management
// ============================================================================

/**
 * Get fuel anomalies with optional filters
 * Uses explicit query branches — sql.unsafe() is not available on the Neon HTTP driver
 */
export async function getFuelAnomalies(options: {
  vehicleId?: string;
  status?: AnomalyStatus;
  severity?: AnomalySeverity;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ anomalies: FuelAnomalyWithVehicle[]; total: number }> {
  const { vehicleId, status, severity, startDate: _startDate, endDate: _endDate, limit = 50, offset = 0 } = options;

  try {
    let rows: FuelAnomalyRow[];
    let countResult: Record<string, unknown>[];

    // Explicit query branches to avoid conditional SQL fragments (Neon requirement)
    if (vehicleId && status) {
      rows = await sql`
        SELECT fa.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_anomalies fa
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE fa.vehicle_id = ${vehicleId} AND fa.status = ${status}
        ORDER BY fa.detected_at DESC LIMIT ${limit} OFFSET ${offset}
      ` as FuelAnomalyRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_anomalies fa
        WHERE fa.vehicle_id = ${vehicleId} AND fa.status = ${status}
      `;
    } else if (status) {
      rows = await sql`
        SELECT fa.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_anomalies fa
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE fa.status = ${status}
        ORDER BY fa.detected_at DESC LIMIT ${limit} OFFSET ${offset}
      ` as FuelAnomalyRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_anomalies fa
        WHERE fa.status = ${status}
      `;
    } else if (vehicleId) {
      rows = await sql`
        SELECT fa.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_anomalies fa
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE fa.vehicle_id = ${vehicleId}
        ORDER BY fa.detected_at DESC LIMIT ${limit} OFFSET ${offset}
      ` as FuelAnomalyRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_anomalies fa
        WHERE fa.vehicle_id = ${vehicleId}
      `;
    } else if (severity) {
      rows = await sql`
        SELECT fa.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_anomalies fa
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        WHERE fa.severity = ${severity}
        ORDER BY fa.detected_at DESC LIMIT ${limit} OFFSET ${offset}
      ` as FuelAnomalyRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_anomalies fa
        WHERE fa.severity = ${severity}
      `;
    } else {
      rows = await sql`
        SELECT fa.*, fv.registration, fv.make, fv.model,
          s.first_name || ' ' || s.last_name as driver_name
        FROM fleet_fuel_anomalies fa
        JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
        LEFT JOIN staff s ON fv.assigned_driver_id = s.id
        ORDER BY fa.detected_at DESC LIMIT ${limit} OFFSET ${offset}
      ` as FuelAnomalyRow[];
      countResult = await sql`
        SELECT COUNT(*)::int as total FROM fleet_fuel_anomalies fa
      `;
    }

    return {
      anomalies: rows.map(rowToFuelAnomaly),
      total: Number(countResult[0]?.total) || 0,
    };
  } catch (error) {
    log.error('Failed to get fuel anomalies', { error, options });
    throw error;
  }
}

/**
 * Update anomaly status
 */
export async function updateAnomalyStatus(
  anomalyId: string,
  status: AnomalyStatus,
  investigatedBy?: string,
  resolutionNotes?: string
): Promise<FuelAnomalyWithVehicle> {
  try {
    const shouldResolve = status === 'resolved' || status === 'dismissed';
    const result = shouldResolve
      ? await sql`
          UPDATE fleet_fuel_anomalies SET
            status = ${status},
            investigated_by = COALESCE(${investigatedBy || null}, investigated_by),
            resolution_notes = COALESCE(${resolutionNotes || null}, resolution_notes),
            resolved_at = NOW()
          WHERE id = ${anomalyId} RETURNING *
        `
      : await sql`
          UPDATE fleet_fuel_anomalies SET
            status = ${status},
            investigated_by = COALESCE(${investigatedBy || null}, investigated_by),
            resolution_notes = COALESCE(${resolutionNotes || null}, resolution_notes)
          WHERE id = ${anomalyId} RETURNING *
        `;

    if (result.length === 0) {
      throw new Error('Anomaly not found');
    }

    // Get with vehicle details
    const detailed = await sql`
      SELECT
        fa.*,
        fv.registration,
        fv.make,
        fv.model,
        s.first_name || ' ' || s.last_name as driver_name
      FROM fleet_fuel_anomalies fa
      JOIN fleet_vehicles fv ON fa.vehicle_id = fv.id
      LEFT JOIN staff s ON fv.assigned_driver_id = s.id
      WHERE fa.id = ${anomalyId}
    `;

    return rowToFuelAnomaly(detailed[0] as FuelAnomalyRow);
  } catch (error) {
    log.error('Failed to update anomaly status', { error, anomalyId, status });
    throw error;
  }
}

// ============================================================================
// Exports
// ============================================================================

export const fuelAnalyticsService = {
  getFuelTransactions,
  getFleetFuelSummary,
  getVehicleFuelStats,
  getFuelEfficiencyTrends,
  getFuelCostBreakdown,
  runAnomalyDetection,
  getFuelAnomalies,
  updateAnomalyStatus,
};

export default fuelAnalyticsService;
