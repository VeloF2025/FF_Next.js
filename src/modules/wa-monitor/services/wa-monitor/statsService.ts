/**
 * WA Monitor Stats Operations
 */

import { log } from '@/lib/logger';
import { getDbConnection } from './_shared';

/**
 * Get project stats by time period (real-time calculation)
 * Returns stats for today, this week, this month, and all-time
 */
export async function getProjectStats(projectName: string): Promise<{
  today: { total: number; complete: number; incomplete: number; completionRate: number };
  week: { total: number; complete: number; incomplete: number; completionRate: number };
  month: { total: number; complete: number; incomplete: number; completionRate: number };
  allTime: { total: number; complete: number; incomplete: number; completionRate: number };
}> {
  const sql = getDbConnection();
  try {
    // Get current date in SAST timezone
    const [dateInfo] = await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_start,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_start
    `;

    // Today's stats
    const [todayStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') = ${dateInfo.today}::date
    `;

    // This week's stats
    const [weekStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.week_start}::date
    `;

    // This month's stats
    const [monthStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
        AND DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.month_start}::date
    `;

    // All-time stats
    const [allTimeStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project = ${projectName}
    `;

    // Helper to calculate stats
    const calcStats = (total: number, complete: number) => ({
      total: parseInt(total as any, 10) || 0,
      complete: parseInt(complete as any, 10) || 0,
      incomplete: (parseInt(total as any, 10) || 0) - (parseInt(complete as any, 10) || 0),
      completionRate: total > 0 ? Math.round((complete / total) * 100) : 0,
    });

    return {
      today: calcStats(todayStats.total, todayStats.complete),
      week: calcStats(weekStats.total, weekStats.complete),
      month: calcStats(monthStats.total, monthStats.complete),
      allTime: calcStats(allTimeStats.total, allTimeStats.complete),
    };
  } catch (error) {
    log.error('Error getting project stats', { error, projectName }, 'waMonitorService.getProjectStats');
    throw new Error('Failed to get project stats');
  }
}

/**
 * Get all projects stats summary (for Projects page overview)
 * Returns stats for all projects combined + comprehensive metrics
 * Supports optional date range filtering
 * @param startDate - Optional start date (YYYY-MM-DD format), defaults to today
 * @param endDate - Optional end date (YYYY-MM-DD format), defaults to today
 */
export async function getAllProjectsStatsSummary(
  startDate?: string,
  endDate?: string
): Promise<{
  total: number;
  complete: number;
  incomplete: number;
  completionRate: number;
  byProject: Array<{
    project: string;
    total: number;
    complete: number;
    completionRate: number;
    overallTotal: number;
    overallComplete: number;
    overallCompletionRate: number;
  }>;
  overallStats: {
    totalInSystem: number;
    completedInSystem: number;
    systemCompletionRate: number;
  };
  trends: {
    weekly: { total: number; complete: number; completionRate: number };
    monthly: { total: number; complete: number; completionRate: number };
  };
  outstanding: {
    totalIncomplete: number;
    needsAttention: number;
    recent: number;
  };
  resubmissions: {
    total: number;
    rate: number;
    firstTimePassRate: number;
  };
  commonFailures: Array<{ step: string; count: number; percentage: number }>;
  feedbackStats: {
    sent: number;
    pending: number;
    sendRate: number;
  };
  agentPerformance: Array<{ agent: string; drops: number; completionRate: number }>;
}> {
  const sql = getDbConnection();
  try {
    // Get current date in SAST timezone
    const [dateInfo] = await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_ago,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_ago
    `;

    // Determine date range for main query
    const queryStartDate = startDate || dateInfo.today;
    const queryEndDate = endDate || dateInfo.today;

    // 1. Stats by project for the selected date range
    const projectStats = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
        AND project != 'Marketing Activations'
      GROUP BY project
      ORDER BY total DESC
    `;

    // 2. Overall system stats (all-time by project)
    const overallProjectStats = await sql`
      SELECT
        COALESCE(project, 'Unknown') as project,
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE project != 'Marketing Activations'
      GROUP BY project
    `;

    // 3. Weekly trends
    const [weeklyStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.week_ago}::date
    `;

    // 4. Monthly trends
    const [monthlyStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg') >= ${dateInfo.month_ago}::date
    `;

    // 5. Outstanding drops
    const [outstandingStats] = await sql`
      SELECT
        COUNT(DISTINCT CASE
          WHEN NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          THEN drop_number
        END) as total_incomplete,
        COUNT(DISTINCT CASE
          WHEN NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          AND COALESCE(whatsapp_message_date, created_at) < NOW() - INTERVAL '7 days'
          THEN drop_number
        END) as needs_attention
      FROM qa_photo_reviews
    `;

    // 6. Resubmission stats
    const [resubmissionStats] = await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total_drops,
        COUNT(DISTINCT CASE WHEN resubmitted = true THEN drop_number END) as resubmitted_drops
      FROM qa_photo_reviews
    `;

    // 7. Common failure points
    const [failureStats] = await sql`
      SELECT
        COUNT(CASE WHEN step_01_house_photo = false THEN 1 END) as step_01_fails,
        COUNT(CASE WHEN step_02_cable_from_pole = false THEN 1 END) as step_02_fails,
        COUNT(CASE WHEN step_03_cable_entry_outside = false THEN 1 END) as step_03_fails,
        COUNT(CASE WHEN step_04_cable_entry_inside = false THEN 1 END) as step_04_fails,
        COUNT(CASE WHEN step_05_wall_for_installation = false THEN 1 END) as step_05_fails,
        COUNT(CASE WHEN step_06_ont_back_after_install = false THEN 1 END) as step_06_fails,
        COUNT(CASE WHEN step_07_power_meter_reading = false THEN 1 END) as step_07_fails,
        COUNT(CASE WHEN step_08_ont_barcode = false THEN 1 END) as step_08_fails,
        COUNT(CASE WHEN step_09_ups_serial = false THEN 1 END) as step_09_fails,
        COUNT(CASE WHEN step_10_final_installation = false THEN 1 END) as step_10_fails,
        COUNT(CASE WHEN step_11_green_lights = false THEN 1 END) as step_11_fails,
        COUNT(CASE WHEN step_12_customer_signature = false THEN 1 END) as step_12_fails,
        COUNT(*) as total_drops
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
    `;

    // 8. Feedback stats
    const [feedbackStats] = await sql`
      SELECT
        COUNT(DISTINCT CASE WHEN feedback_sent IS NOT NULL THEN drop_number END) as sent,
        COUNT(DISTINCT CASE
          WHEN feedback_sent IS NULL
          AND NOT (
            step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          )
          THEN drop_number
        END) as pending
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
    `;

    // 9. Agent performance for the selected date range
    const agentStats = await sql`
      SELECT
        COALESCE(assigned_agent, 'Unassigned') as agent,
        COUNT(DISTINCT drop_number) as drops,
        COUNT(DISTINCT CASE
          WHEN step_01_house_photo = true AND step_02_cable_from_pole = true
            AND step_03_cable_entry_outside = true AND step_04_cable_entry_inside = true
            AND step_05_wall_for_installation = true AND step_06_ont_back_after_install = true
            AND step_07_power_meter_reading = true AND step_08_ont_barcode = true
            AND step_09_ups_serial = true AND step_10_final_installation = true
            AND step_11_green_lights = true AND step_12_customer_signature = true
          THEN drop_number
        END) as complete
      FROM qa_photo_reviews
      WHERE DATE(COALESCE(whatsapp_message_date, created_at) AT TIME ZONE 'Africa/Johannesburg')
        BETWEEN ${queryStartDate}::date AND ${queryEndDate}::date
        AND assigned_agent IS NOT NULL
      GROUP BY assigned_agent
      ORDER BY complete DESC, drops DESC
      LIMIT 10
    `;

    // Calculate totals
    const todayTotal = projectStats.reduce((sum, p) => sum + parseInt(p.total as any, 10), 0);
    const todayComplete = projectStats.reduce((sum, p) => sum + parseInt(p.complete as any, 10), 0);

    const overallTotal = overallProjectStats.reduce((sum, p) => sum + parseInt(p.total as any, 10), 0);
    const overallComplete = overallProjectStats.reduce((sum, p) => sum + parseInt(p.complete as any, 10), 0);

    // Process common failures
    const stepLabels: { [key: string]: string } = {
      step_01_fails: 'House photo',
      step_02_fails: 'Cable from pole',
      step_03_fails: 'Cable entry outside',
      step_04_fails: 'Cable entry inside',
      step_05_fails: 'Wall for installation',
      step_06_fails: 'ONT back after install',
      step_07_fails: 'Power meter reading',
      step_08_fails: 'ONT barcode',
      step_09_fails: 'UPS serial',
      step_10_fails: 'Final installation',
      step_11_fails: 'Green lights',
      step_12_fails: 'Customer signature',
    };

    const failures = Object.entries(stepLabels)
      .map(([key, label]) => ({
        step: label,
        count: parseInt((failureStats as any)[key], 10) || 0,
        percentage: failureStats.total_drops > 0
          ? Math.round((parseInt((failureStats as any)[key], 10) / parseInt(failureStats.total_drops, 10)) * 100)
          : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Build overall stats map
    const overallMap = new Map(
      overallProjectStats.map(p => [p.project, {
        total: parseInt(p.total as any, 10),
        complete: parseInt(p.complete as any, 10),
      }])
    );

    const totalResubmitted = parseInt(resubmissionStats.resubmitted_drops as any, 10) || 0;
    const totalDropsForResubmission = parseInt(resubmissionStats.total_drops as any, 10) || 0;

    return {
      total: todayTotal,
      complete: todayComplete,
      incomplete: todayTotal - todayComplete,
      completionRate: todayTotal > 0 ? Math.round((todayComplete / todayTotal) * 100) : 0,
      byProject: projectStats.map(p => {
        const overall = overallMap.get(p.project) || { total: 0, complete: 0 };
        return {
          project: p.project,
          total: parseInt(p.total as any, 10),
          complete: parseInt(p.complete as any, 10),
          completionRate: p.total > 0 ? Math.round((parseInt(p.complete as any, 10) / parseInt(p.total as any, 10)) * 100) : 0,
          overallTotal: overall.total,
          overallComplete: overall.complete,
          overallCompletionRate: overall.total > 0 ? Math.round((overall.complete / overall.total) * 100) : 0,
        };
      }),
      overallStats: {
        totalInSystem: overallTotal,
        completedInSystem: overallComplete,
        systemCompletionRate: overallTotal > 0 ? Math.round((overallComplete / overallTotal) * 100) : 0,
      },
      trends: {
        weekly: {
          total: parseInt(weeklyStats.total as any, 10) || 0,
          complete: parseInt(weeklyStats.complete as any, 10) || 0,
          completionRate: weeklyStats.total > 0
            ? Math.round((parseInt(weeklyStats.complete as any, 10) / parseInt(weeklyStats.total as any, 10)) * 100)
            : 0,
        },
        monthly: {
          total: parseInt(monthlyStats.total as any, 10) || 0,
          complete: parseInt(monthlyStats.complete as any, 10) || 0,
          completionRate: monthlyStats.total > 0
            ? Math.round((parseInt(monthlyStats.complete as any, 10) / parseInt(monthlyStats.total as any, 10)) * 100)
            : 0,
        },
      },
      outstanding: {
        totalIncomplete: parseInt(outstandingStats.total_incomplete as any, 10) || 0,
        needsAttention: parseInt(outstandingStats.needs_attention as any, 10) || 0,
        recent: (parseInt(outstandingStats.total_incomplete as any, 10) || 0) - (parseInt(outstandingStats.needs_attention as any, 10) || 0),
      },
      resubmissions: {
        total: totalResubmitted,
        rate: totalDropsForResubmission > 0 ? Math.round((totalResubmitted / totalDropsForResubmission) * 100) : 0,
        firstTimePassRate: totalDropsForResubmission > 0
          ? Math.round(((totalDropsForResubmission - totalResubmitted) / totalDropsForResubmission) * 100)
          : 100,
      },
      commonFailures: failures,
      feedbackStats: {
        sent: parseInt(feedbackStats.sent as any, 10) || 0,
        pending: parseInt(feedbackStats.pending as any, 10) || 0,
        sendRate: (parseInt(feedbackStats.sent as any, 10) + parseInt(feedbackStats.pending as any, 10)) > 0
          ? Math.round((parseInt(feedbackStats.sent as any, 10) / (parseInt(feedbackStats.sent as any, 10) + parseInt(feedbackStats.pending as any, 10))) * 100)
          : 0,
      },
      agentPerformance: agentStats.map(a => ({
        agent: a.agent,
        drops: parseInt(a.drops as any, 10),
        completionRate: a.drops > 0 ? Math.round((parseInt(a.complete as any, 10) / parseInt(a.drops as any, 10)) * 100) : 0,
      })),
    };
  } catch (error) {
    log.error('Error getting all projects stats summary', { error, startDate, endDate }, 'waMonitorService.getAllProjectsStatsSummary');
    throw new Error('Failed to get all projects stats summary');
  }
}

/**
 * Validate database connection
 */
export async function validateConnection(): Promise<boolean> {
  try {
    const sql = getDbConnection();
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    log.error('Database connection failed', { error }, 'waMonitorService.validateConnection');
    return false;
  }
}
