/**
 * Resubmission Analysis Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  ResubmissionAnalysisResponse,
  ResubmissionMetrics,
  TopResubmittedDR,
} from '../../types/reporting.types';

/**
 * Get resubmission analysis report
 */
export async function getResubmissionReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<ResubmissionAnalysisResponse> {
  try {
    log.info('ReportingService', 'Getting resubmission report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get summary and by-project breakdown
    const summaryResult = await pool.query(
      `
      SELECT
        upr.project,
        COUNT(*) as total_drs,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmitted_drs,
        AVG(upr.submission_count) as avg_submissions,
        MAX(upr.submission_count) as max_submissions
      FROM dr_photo_unified_reviews upr
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      GROUP BY upr.project
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get by-user breakdown
    const userResult = await pool.query(
      `
      SELECT
        COALESCE(qpr.user_name, 'Unknown') as group_name,
        COUNT(*) as total_drs,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmitted_drs,
        AVG(upr.submission_count) as avg_submissions,
        MAX(upr.submission_count) as max_submissions
      FROM dr_photo_unified_reviews upr
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      GROUP BY COALESCE(qpr.user_name, 'Unknown')
      ORDER BY resubmitted_drs DESC
      LIMIT 20
      `,
      [dateFrom, dateTo, project || null]
    );

    // Get top resubmitted DRs
    const topResult = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        upr.submission_count,
        upr.created_at as first_submitted_at,
        upr.last_resubmitted_at,
        qpr.user_name as submitted_by
      FROM dr_photo_unified_reviews upr
      LEFT JOIN qa_photo_reviews qpr ON upr.drop_number = qpr.drop_number
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
        AND upr.submission_count > 1
      ORDER BY upr.submission_count DESC
      LIMIT 20
      `,
      [dateFrom, dateTo, project || null]
    );

    const byProject: ResubmissionMetrics[] = summaryResult.rows.map((row) => ({
      group_name: row.project || 'Unknown',
      total_drs: parseInt(row.total_drs, 10) || 0,
      resubmitted_drs: parseInt(row.resubmitted_drs, 10) || 0,
      resubmission_rate:
        row.total_drs > 0
          ? Math.round((parseInt(row.resubmitted_drs, 10) / parseInt(row.total_drs, 10)) * 100)
          : 0,
      avg_submissions: parseFloat(row.avg_submissions) || 1,
      max_submissions: parseInt(row.max_submissions, 10) || 1,
    }));

    const byUser: ResubmissionMetrics[] = userResult.rows.map((row) => ({
      group_name: row.group_name,
      total_drs: parseInt(row.total_drs, 10) || 0,
      resubmitted_drs: parseInt(row.resubmitted_drs, 10) || 0,
      resubmission_rate:
        row.total_drs > 0
          ? Math.round((parseInt(row.resubmitted_drs, 10) / parseInt(row.total_drs, 10)) * 100)
          : 0,
      avg_submissions: parseFloat(row.avg_submissions) || 1,
      max_submissions: parseInt(row.max_submissions, 10) || 1,
    }));

    const topResubmitted: TopResubmittedDR[] = topResult.rows.map((row) => ({
      drop_number: row.drop_number,
      project: row.project,
      submission_count: parseInt(row.submission_count, 10) || 1,
      first_submitted_at: row.first_submitted_at
        ? new Date(row.first_submitted_at).toISOString()
        : '',
      last_resubmitted_at: row.last_resubmitted_at
        ? new Date(row.last_resubmitted_at).toISOString()
        : '',
      submitted_by: row.submitted_by,
    }));

    // Calculate overall summary
    const totalDrs = byProject.reduce((sum, p) => sum + p.total_drs, 0);
    const totalResubmitted = byProject.reduce((sum, p) => sum + p.resubmitted_drs, 0);
    const totalAvgSubmissions =
      byProject.length > 0
        ? byProject.reduce((sum, p) => sum + p.avg_submissions * p.total_drs, 0) / totalDrs
        : 1;

    return {
      date_range: { from: dateFrom, to: dateTo },
      summary: {
        total_drs: totalDrs,
        resubmitted_drs: totalResubmitted,
        resubmission_rate: totalDrs > 0 ? Math.round((totalResubmitted / totalDrs) * 100) : 0,
        avg_submissions: Math.round(totalAvgSubmissions * 10) / 10,
      },
      by_project: byProject,
      by_user: byUser,
      top_resubmitted: topResubmitted,
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get resubmission report', { error });
    throw error;
  }
}
