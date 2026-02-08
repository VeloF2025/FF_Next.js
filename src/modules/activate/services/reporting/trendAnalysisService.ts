/**
 * Trend Analysis Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  TrendAnalysisResponse,
  TrendDataPoint,
  TrendGroupBy,
} from '../../types/reporting.types';

/**
 * Get trend analysis report with velocity metrics
 * Includes per-project breakdown when no project filter is applied
 */
export async function getTrendAnalysisReport(
  dateFrom: string,
  dateTo: string,
  groupBy: TrendGroupBy = 'day',
  project?: string
): Promise<TrendAnalysisResponse> {
  try {
    log.info('ReportingService', 'Getting trend analysis report', {
      dateFrom,
      dateTo,
      groupBy,
      project,
    });

    const dateGrouping =
      groupBy === 'day'
        ? "TO_CHAR(ds.date_val, 'YYYY-MM-DD')"
        : groupBy === 'week'
          ? "TO_CHAR(DATE_TRUNC('week', ds.date_val), 'YYYY-\"W\"IW')"
          : "TO_CHAR(DATE_TRUNC('month', ds.date_val), 'YYYY-MM')";

    // Main aggregated query
    const result = await pool.query(
      `
      -- CRITICAL: INNER JOIN to drops to exclude invalid DR numbers from counts
      WITH date_series AS (
        SELECT generate_series($1::DATE, $2::DATE, '1 day'::interval)::DATE as date_val
      ),
      wa_counts AS (
        SELECT
          COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
          COUNT(DISTINCT upr.drop_number) as installed,
          COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent = true) as reviewed,
          COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent IS NULL OR upr.feedback_sent = false) as not_reviewed
        FROM dr_photo_unified_reviews upr
        INNER JOIN drops d ON d.drop_number = upr.drop_number
        WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
          AND ($3::TEXT IS NULL OR upr.project = $3)
        GROUP BY COALESCE(upr.submitted_date, upr.created_at::DATE)
      ),
      oes_counts AS (
        SELECT
          oes.activation_date as date_val,
          COUNT(DISTINCT oes.drop_number) as activated
        FROM oes_activations oes
        INNER JOIN drops d ON d.drop_number = oes.drop_number
        LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
        WHERE oes.activation_date >= $1::DATE
          AND oes.activation_date <= $2::DATE
          AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
        GROUP BY oes.activation_date
      )
      SELECT
        ${dateGrouping} as label,
        ds.date_val::TEXT as date,
        COALESCE(SUM(w.installed), 0)::INT as installed,
        COALESCE(SUM(o.activated), 0)::INT as activated,
        COALESCE(SUM(w.reviewed), 0)::INT as reviewed,
        COALESCE(SUM(w.not_reviewed), 0)::INT as not_reviewed
      FROM date_series ds
      LEFT JOIN wa_counts w ON w.date_val = ds.date_val
      LEFT JOIN oes_counts o ON o.date_val = ds.date_val
      GROUP BY ${dateGrouping}, ds.date_val
      ORDER BY ds.date_val
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get per-project breakdown (only when no project filter)
    const projectBreakdown: Map<string, Map<string, { installed: number; activated: number; reviewed: number; notReviewed: number }>> = new Map();
    let availableProjects: string[] = [];

    if (!project) {
      // Query for per-project data
      // CRITICAL: INNER JOIN to drops to exclude invalid DR numbers
      const projectResult = await pool.query(
        `
        WITH date_series AS (
          SELECT generate_series($1::DATE, $2::DATE, '1 day'::interval)::DATE as date_val
        ),
        wa_by_project AS (
          SELECT
            COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
            upr.project,
            COUNT(DISTINCT upr.drop_number) as installed,
            COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent = true) as reviewed,
            COUNT(DISTINCT upr.drop_number) FILTER (WHERE upr.feedback_sent IS NULL OR upr.feedback_sent = false) as not_reviewed
          FROM dr_photo_unified_reviews upr
          INNER JOIN drops d ON d.drop_number = upr.drop_number
          WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
            AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
            AND upr.project IS NOT NULL
          GROUP BY COALESCE(upr.submitted_date, upr.created_at::DATE), upr.project
        ),
        oes_by_project AS (
          SELECT
            oes.activation_date as date_val,
            COALESCE(upr.project, 'Unknown') as project,
            COUNT(DISTINCT oes.drop_number) as activated
          FROM oes_activations oes
          INNER JOIN drops d ON d.drop_number = oes.drop_number
          LEFT JOIN dr_photo_unified_reviews upr ON upr.drop_number = oes.drop_number
          WHERE oes.activation_date >= $1::DATE
            AND oes.activation_date <= $2::DATE
          GROUP BY oes.activation_date, COALESCE(upr.project, 'Unknown')
        )
        SELECT
          ${dateGrouping} as label,
          COALESCE(w.project, o.project) as project,
          COALESCE(SUM(w.installed), 0)::INT as installed,
          COALESCE(SUM(o.activated), 0)::INT as activated,
          COALESCE(SUM(w.reviewed), 0)::INT as reviewed,
          COALESCE(SUM(w.not_reviewed), 0)::INT as not_reviewed
        FROM date_series ds
        LEFT JOIN wa_by_project w ON w.date_val = ds.date_val
        LEFT JOIN oes_by_project o ON o.date_val = ds.date_val AND (w.project = o.project OR w.project IS NULL OR o.project IS NULL)
        WHERE COALESCE(w.project, o.project) IS NOT NULL
        GROUP BY ${dateGrouping}, COALESCE(w.project, o.project), ds.date_val
        ORDER BY ds.date_val, project
        `,
        [dateFrom, dateTo]
      );

      // Build project breakdown map
      const projectSet = new Set<string>();
      for (const row of projectResult.rows) {
        const dateLabel = row.label;
        const proj = row.project;
        projectSet.add(proj);

        if (!projectBreakdown.has(dateLabel)) {
          projectBreakdown.set(dateLabel, new Map());
        }
        projectBreakdown.get(dateLabel)!.set(proj, {
          installed: parseInt(row.installed, 10) || 0,
          activated: parseInt(row.activated, 10) || 0,
          reviewed: parseInt(row.reviewed, 10) || 0,
          notReviewed: parseInt(row.not_reviewed, 10) || 0,
        });
      }
      availableProjects = Array.from(projectSet).sort();
    }

    const data: TrendDataPoint[] = result.rows.map((row) => {
      const point: TrendDataPoint = {
        label: row.label,
        date: row.date,
        installed: parseInt(row.installed, 10) || 0,
        activated: parseInt(row.activated, 10) || 0,
        reviewed: parseInt(row.reviewed, 10) || 0,
        notReviewed: parseInt(row.not_reviewed, 10) || 0,
      };

      // Add per-project breakdown if available
      if (projectBreakdown.has(row.label)) {
        const byProject: Record<string, { installed: number; activated: number; reviewed: number; notReviewed: number }> = {};
        projectBreakdown.get(row.label)!.forEach((val, proj) => {
          byProject[proj] = val;
        });
        point.by_project = byProject;
      }

      return point;
    });

    // Calculate velocity metrics
    const totalPeriods = data.filter((d) => d.installed > 0 || d.activated > 0).length || 1;
    const totalInstalled = data.reduce((sum, d) => sum + d.installed, 0);
    const totalActivated = data.reduce((sum, d) => sum + d.activated, 0);

    // Compare last half vs first half for trend direction
    const midpoint = Math.floor(data.length / 2);
    const firstHalfInstalled = data.slice(0, midpoint).reduce((sum, d) => sum + d.installed, 0);
    const secondHalfInstalled = data.slice(midpoint).reduce((sum, d) => sum + d.installed, 0);
    const firstHalfActivated = data.slice(0, midpoint).reduce((sum, d) => sum + d.activated, 0);
    const secondHalfActivated = data.slice(midpoint).reduce((sum, d) => sum + d.activated, 0);

    const installedChange =
      firstHalfInstalled > 0
        ? ((secondHalfInstalled - firstHalfInstalled) / firstHalfInstalled) * 100
        : 0;
    const activatedChange =
      firstHalfActivated > 0
        ? ((secondHalfActivated - firstHalfActivated) / firstHalfActivated) * 100
        : 0;

    const velocity: {
      avg_installed: number;
      avg_activated: number;
      installed_trend: 'up' | 'down' | 'stable';
      activated_trend: 'up' | 'down' | 'stable';
      installed_wow_change: number;
      activated_wow_change: number;
    } = {
      avg_installed: totalInstalled / totalPeriods,
      avg_activated: totalActivated / totalPeriods,
      installed_trend: installedChange > 5 ? 'up' : installedChange < -5 ? 'down' : 'stable',
      activated_trend: activatedChange > 5 ? 'up' : activatedChange < -5 ? 'down' : 'stable',
      installed_wow_change: Math.round(installedChange),
      activated_wow_change: Math.round(activatedChange),
    };

    return {
      date_range: { from: dateFrom, to: dateTo },
      group_by: groupBy,
      project: project || null,
      available_projects: availableProjects,
      data,
      velocity,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get trend analysis report', { error });
    throw error;
  }
}
