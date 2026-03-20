/**
 * WA Monitor Stats Operations
 */

import { log } from '@/lib/logger';
import { getDbConnection } from './_shared';

// ─── SQL Row Interfaces ───────────────────────────────────────────────────────
// PostgreSQL COUNT() aggregates return string in JS (BigInt serialisation).
// Typing each row shape eliminates `as any` casts on SQL results.

interface DatePeriodRow {
  today: string;
  week_start: string;
  month_start: string;
}

interface DateRangeRow {
  today: string;
  week_ago: string;
  month_ago: string;
}

interface StatsRow {
  total: string;
  complete: string;
}

interface ProjectStatsRow {
  project: string;
  total: string;
  complete: string;
}

interface OutstandingRow {
  total_incomplete: string;
  needs_attention: string;
}

interface ResubmissionRow {
  total_drops: string;
  resubmitted_drops: string;
}

interface FailureStatsRow {
  step_01_fails: string;
  step_02_fails: string;
  step_03_fails: string;
  step_04_fails: string;
  step_05_fails: string;
  step_06_fails: string;
  step_07_fails: string;
  step_08_fails: string;
  step_09_fails: string;
  step_10_fails: string;
  step_11_fails: string;
  step_12_fails: string;
  total_drops: string;
}

interface FeedbackStatsRow {
  sent: string;
  pending: string;
}

interface AgentStatsRow {
  agent: string;
  drops: string;
  complete: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse SQL COUNT / aggregate values (returned as strings by PostgreSQL driver) */
function parseCount(v: string | number | null | undefined): number {
  return parseInt(String(v ?? 0), 10) || 0;
}

// ─── Service Functions ────────────────────────────────────────────────────────

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
    const [dateInfo] = (await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_start,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_start
    `) as unknown as DatePeriodRow[];

    // Today's stats
    const [todayStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // This week's stats
    const [weekStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // This month's stats
    const [monthStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // All-time stats
    const [allTimeStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // Helper to calculate stats
    const calcStats = (total: string, complete: string) => {
      const t = parseCount(total);
      const c = parseCount(complete);
      return {
        total: t,
        complete: c,
        incomplete: t - c,
        completionRate: t > 0 ? Math.round((c / t) * 100) : 0,
      };
    };

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
    const [dateInfo] = (await sql`
      SELECT
        CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' as today,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '7 days')::date as week_ago,
        (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg' - INTERVAL '30 days')::date as month_ago
    `) as unknown as DateRangeRow[];

    // Determine date range for main query
    const queryStartDate = startDate || dateInfo.today;
    const queryEndDate = endDate || dateInfo.today;

    // 1. Stats by project for the selected date range
    const projectStats = (await sql`
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
    `) as unknown as ProjectStatsRow[];

    // 2. Overall system stats (all-time by project)
    const overallProjectStats = (await sql`
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
    `) as unknown as ProjectStatsRow[];

    // 3. Weekly trends
    const [weeklyStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // 4. Monthly trends
    const [monthlyStats] = (await sql`
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
    `) as unknown as StatsRow[];

    // 5. Outstanding drops
    const [outstandingStats] = (await sql`
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
    `) as unknown as OutstandingRow[];

    // 6. Resubmission stats
    const [resubmissionStats] = (await sql`
      SELECT
        COUNT(DISTINCT drop_number) as total_drops,
        COUNT(DISTINCT CASE WHEN resubmitted = true THEN drop_number END) as resubmitted_drops
      FROM qa_photo_reviews
    `) as unknown as ResubmissionRow[];

    // 7. Common failure points
    const [failureStats] = (await sql`
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
    `) as unknown as FailureStatsRow[];

    // 8. Feedback stats
    const [feedbackStats] = (await sql`
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
    `) as unknown as FeedbackStatsRow[];

    // 9. Agent performance for the selected date range
    const agentStats = (await sql`
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
    `) as unknown as AgentStatsRow[];

    // Calculate totals
    const todayTotal = projectStats.reduce((sum, p) => sum + parseCount(p.total), 0);
    const todayComplete = projectStats.reduce((sum, p) => sum + parseCount(p.complete), 0);

    const overallTotal = overallProjectStats.reduce((sum, p) => sum + parseCount(p.total), 0);
    const overallComplete = overallProjectStats.reduce((sum, p) => sum + parseCount(p.complete), 0);

    // Process common failures
    const stepLabels: Record<keyof Omit<FailureStatsRow, 'total_drops'>, string> = {
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

    const totalDrops = parseCount(failureStats.total_drops);
    const failures = (Object.entries(stepLabels) as [keyof Omit<FailureStatsRow, 'total_drops'>, string][])
      .map(([key, label]) => {
        const count = parseCount(failureStats[key]);
        return {
          step: label,
          count,
          percentage: totalDrops > 0 ? Math.round((count / totalDrops) * 100) : 0,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Build overall stats map
    const overallMap = new Map(
      overallProjectStats.map(p => [p.project, {
        total: parseCount(p.total),
        complete: parseCount(p.complete),
      }])
    );

    const totalResubmitted = parseCount(resubmissionStats.resubmitted_drops);
    const totalDropsForResubmission = parseCount(resubmissionStats.total_drops);

    const feedbackSent = parseCount(feedbackStats.sent);
    const feedbackPending = parseCount(feedbackStats.pending);
    const weeklyTotal = parseCount(weeklyStats.total);
    const weeklyComplete = parseCount(weeklyStats.complete);
    const monthlyTotal = parseCount(monthlyStats.total);
    const monthlyComplete = parseCount(monthlyStats.complete);
    const totalIncomplete = parseCount(outstandingStats.total_incomplete);
    const needsAttention = parseCount(outstandingStats.needs_attention);

    return {
      total: todayTotal,
      complete: todayComplete,
      incomplete: todayTotal - todayComplete,
      completionRate: todayTotal > 0 ? Math.round((todayComplete / todayTotal) * 100) : 0,
      byProject: projectStats.map(p => {
        const overall = overallMap.get(p.project) ?? { total: 0, complete: 0 };
        const t = parseCount(p.total);
        const c = parseCount(p.complete);
        return {
          project: p.project,
          total: t,
          complete: c,
          completionRate: t > 0 ? Math.round((c / t) * 100) : 0,
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
          total: weeklyTotal,
          complete: weeklyComplete,
          completionRate: weeklyTotal > 0 ? Math.round((weeklyComplete / weeklyTotal) * 100) : 0,
        },
        monthly: {
          total: monthlyTotal,
          complete: monthlyComplete,
          completionRate: monthlyTotal > 0 ? Math.round((monthlyComplete / monthlyTotal) * 100) : 0,
        },
      },
      outstanding: {
        totalIncomplete,
        needsAttention,
        recent: totalIncomplete - needsAttention,
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
        sent: feedbackSent,
        pending: feedbackPending,
        sendRate: (feedbackSent + feedbackPending) > 0
          ? Math.round((feedbackSent / (feedbackSent + feedbackPending)) * 100)
          : 0,
      },
      agentPerformance: agentStats.map(a => {
        const drops = parseCount(a.drops);
        const complete = parseCount(a.complete);
        return {
          agent: a.agent,
          drops,
          completionRate: drops > 0 ? Math.round((complete / drops) * 100) : 0,
        };
      }),
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
