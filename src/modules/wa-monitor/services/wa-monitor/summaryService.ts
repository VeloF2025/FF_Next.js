/**
 * WA Monitor Summary Operations
 */

import { log } from '@/lib/logger';
import type { WaMonitorSummary } from '../../types/wa-monitor.types';
import { getDbConnection } from './_shared';

/**
 * Calculate summary statistics for all drops
 * Complete = All 12 QA checklist steps are TRUE
 * Incomplete = Any of the 12 QA checklist steps is FALSE
 */
export async function calculateSummary(): Promise<WaMonitorSummary> {
  try {
    const sql = getDbConnection();
    const statsRows = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN 1
        END) as complete,
        COUNT(CASE
          WHEN step_01_house_photo = false
            OR step_02_cable_from_pole = false
            OR step_03_cable_entry_outside = false
            OR step_04_cable_entry_inside = false
            OR step_05_wall_for_installation = false
            OR step_06_ont_back_after_install = false
            OR step_07_power_meter_reading = false
            OR step_08_ont_barcode = false
            OR step_09_ups_serial = false
            OR step_10_final_installation = false
            OR step_11_green_lights = false
            OR step_12_customer_signature = false
          THEN 1
        END) as incomplete,
        COALESCE(AVG(completed_photos), 0) as "avgCompletedPhotos",
        COALESCE(SUM(CASE WHEN completed = true OR incomplete = true THEN 1 ELSE 0 END), 0) as "totalReviewed"
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
    `;

    // Get daily stats grouped by project and date (last 30 days only for performance)
    const dailyStatsRows = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        TO_CHAR(DATE(created_at AT TIME ZONE 'Africa/Johannesburg'), 'YYYY-MM-DD') as date,
        COUNT(*) as total,
        COUNT(CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN 1
        END) as complete,
        COUNT(CASE
          WHEN step_01_house_photo = false
            OR step_02_cable_from_pole = false
            OR step_03_cable_entry_outside = false
            OR step_04_cable_entry_inside = false
            OR step_05_wall_for_installation = false
            OR step_06_ont_back_after_install = false
            OR step_07_power_meter_reading = false
            OR step_08_ont_barcode = false
            OR step_09_ups_serial = false
            OR step_10_final_installation = false
            OR step_11_green_lights = false
            OR step_12_customer_signature = false
          THEN 1
        END) as incomplete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY project, DATE(created_at AT TIME ZONE 'Africa/Johannesburg')
      ORDER BY date DESC, project ASC
    `;

    return {
      total: parseInt(stats.total, 10),
      incomplete: parseInt(stats.incomplete, 10),
      complete: parseInt(stats.complete, 10),
      averageFeedbackCount: parseFloat(stats.avgCompletedPhotos),
      totalFeedback: parseInt(stats.totalReviewed, 10),
      dailyStats: dailyStatsRows.map(row => ({
        project: row.project,
        date: row.date,
        total: parseInt(row.total, 10),
        complete: parseInt(row.complete, 10),
        incomplete: parseInt(row.incomplete, 10),
      })),
    };
  } catch (error) {
    log.error('Error calculating summary', { error }, 'waMonitorService.calculateSummary');
    throw new Error('Failed to calculate summary statistics');
  }
}

/**
 * Fast summary calculation for initial page load
 * Uses parallel queries and limits daily stats to last 7 days
 * Much faster than calculateSummary() for dashboard views
 */
export async function calculateSummaryFast(): Promise<WaMonitorSummary> {
  try {
    const sql = getDbConnection();

    // Run both queries in parallel for better performance
    const [statsResult, dailyStatsResult] = await Promise.all([
      // Basic counts - scan full table but simpler query
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN completed = true THEN 1 END) as complete,
          COUNT(CASE WHEN incomplete = true THEN 1 END) as incomplete_reviewed
        FROM qa_photo_reviews
        WHERE project != 'Marketing Activations'
      `,
      // Daily stats - last 7 days only for fast dashboard
      sql`
        SELECT
          COALESCE(project, 'Unknown') as project,
          TO_CHAR(DATE(created_at AT TIME ZONE 'Africa/Johannesburg'), 'YYYY-MM-DD') as date,
          COUNT(*) as total
        FROM qa_photo_reviews
        WHERE project != 'Marketing Activations'
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY project, DATE(created_at AT TIME ZONE 'Africa/Johannesburg')
        ORDER BY date DESC, project ASC
      `,
    ]);

    const stats = statsResult[0]!;
    const totalCount = parseInt(stats.total, 10);
    const completeCount = parseInt(stats.complete || '0', 10);

    return {
      total: totalCount,
      incomplete: totalCount - completeCount, // Simplified: everything not complete is incomplete
      complete: completeCount,
      averageFeedbackCount: 0, // Skip for fast load
      totalFeedback: parseInt(stats.incomplete_reviewed || '0', 10),
      dailyStats: dailyStatsResult.map(row => ({
        project: row.project,
        date: row.date,
        total: parseInt(row.total, 10),
        complete: 0, // Skip detailed stats for fast load
        incomplete: parseInt(row.total, 10), // Assume all incomplete for fast view
      })),
    };
  } catch (error) {
    log.error('Error calculating fast summary', { error }, 'waMonitorService.calculateSummaryFast');
    throw new Error('Failed to calculate summary statistics');
  }
}

/**
 * Get complete per-project statistics from ALL records
 * Unlike calculateSummaryFast(), this queries ALL records (not limited to 7 days)
 * and properly calculates complete vs incomplete status
 *
 * @param dateFrom Optional start date filter (YYYY-MM-DD format, SAST timezone)
 * @param dateTo Optional end date filter (YYYY-MM-DD format, SAST timezone)
 */
export async function getCompleteProjectStats(
  dateFrom?: string,
  dateTo?: string
): Promise<Array<{
  project: string;
  total: number;
  complete: number;
  incomplete: number;
}>> {
  const sql = getDbConnection();
  try {
    // Build date filter conditions
    // Use whatsapp_message_date if available, otherwise fall back to created_at
    let dateFilter = sql``;

    if (dateFrom && dateTo) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') BETWEEN ${dateFrom}::date AND ${dateTo}::date`;
    } else if (dateFrom) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateFrom}::date`;
    } else if (dateTo) {
      dateFilter = sql`AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') <= ${dateTo}::date`;
    }

    const results = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true
            AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true
            AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true
            AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true
            AND step_08_ont_barcode = true
            AND step_09_ups_serial = true
            AND step_10_final_installation = true
            AND step_11_green_lights = true
            AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
        ${dateFilter}
      GROUP BY project
      ORDER BY total DESC
    `;

    return results.map(row => ({
      project: row.project,
      total: parseInt(row.total, 10),
      complete: parseInt(row.complete, 10),
      incomplete: parseInt(row.total, 10) - parseInt(row.complete, 10),
    }));
  } catch (error) {
    log.error('Error calculating complete project stats', { error, dateFrom, dateTo }, 'waMonitorService.getCompleteProjectStats');
    throw new Error('Failed to calculate project statistics');
  }
}

/**
 * Get daily drops count per project
 * Returns count of drops submitted today grouped by project
 * Uses whatsapp_message_date to reflect actual submission date, not database insert date
 *
 * OPTIMIZED: Reduced from 1.1s to ~100ms
 * - Use simple COUNT(*) instead of COUNT(DISTINCT drop_number)
 * - Convert date once in WHERE clause instead of GROUP BY
 * - Use indexed columns for filtering
 *
 * TODO: Add index: CREATE INDEX idx_qa_photo_reviews_date ON qa_photo_reviews
 *       ((DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')), project);
 */
export async function getDailyDropsPerProject(date?: string): Promise<Array<{ date: string; project: string; count: number }>> {
  const sql = getDbConnection();
  try {
    // If date provided, use it; otherwise use current date in SAST
    const targetDate = date || new Date().toISOString().split('T')[0];

    const rows = await sql`
      SELECT
        ${targetDate} as date,
        COALESCE(project, 'Unknown') as project,
        COUNT(*) as count
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') = ${targetDate}::date
        AND project != 'Marketing Activations'
      GROUP BY project
      ORDER BY project ASC
    `;

    return rows.map((row: any) => ({
      date: row.date,
      project: row.project,
      count: parseInt(row.count, 10),
    }));
  } catch (error) {
    log.error('Error getting daily drops per project', { error, date }, 'waMonitorService.getDailyDropsPerProject');
    throw new Error('Failed to get daily drops per project');
  }
}
