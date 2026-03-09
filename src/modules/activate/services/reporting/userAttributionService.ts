/**
 * User/Team Attribution Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  UserTeamAttributionResponse,
  UserPerformance,
  TeamPerformance,
} from '../../types/reporting.types';

/**
 * Get user/team attribution report
 *
 * TERMINOLOGY:
 * - INSTALLED: DR submitted via WhatsApp (installation was done)
 * - REVIEWED: feedback_sent = true (QA has reviewed and sent feedback)
 * - NOT REVIEWED: feedback_sent = false or null
 * - ACTIVATED: DR confirmed as active on OES report
 *
 * Shows performance metrics for:
 * - Users who submitted DRs via WhatsApp
 * - Teams who installed (from OES)
 */
export async function getUserTeamAttributionReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<UserTeamAttributionResponse> {
  try {
    log.info('Getting user/team attribution report', {
      dateFrom,
      dateTo,
      project,
    }, 'ReportingService');

    // Query for user performance with consistent terminology
    const userResult = await pool.query(
      `
      SELECT
        qpr.user_name,
        qpr.sender_phone,
        qpr.project,
        COUNT(*) as installed,
        COUNT(*) FILTER (WHERE upr.feedback_sent = true) as reviewed,
        COUNT(*) FILTER (WHERE oes.drop_number IS NOT NULL) as activated,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned,
        COUNT(*) FILTER (WHERE upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_scanned
      FROM qa_photo_reviews qpr
      LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      LEFT JOIN oes_activations oes ON qpr.drop_number = oes.drop_number
      WHERE COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE >= $1::DATE
        AND COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR qpr.project = $3)
      GROUP BY qpr.user_name, qpr.sender_phone, qpr.project
      ORDER BY installed DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map user performance with consistent terminology
    const users: UserPerformance[] = userResult.rows.map((row) => {
      const installed = parseInt(row.installed, 10) || 0;
      const reviewed = parseInt(row.reviewed, 10) || 0;
      const activated = parseInt(row.activated, 10) || 0;
      const ontScanned = parseInt(row.ont_scanned, 10) || 0;
      const upsScanned = parseInt(row.ups_scanned, 10) || 0;

      return {
        user_name: row.user_name,
        sender_phone: row.sender_phone,
        project: row.project || 'Unknown',
        installed,
        reviewed,
        notReviewed: installed - reviewed,
        activated,
        review_rate: installed > 0 ? Math.round((reviewed / installed) * 100) : 0,
        activation_rate: installed > 0 ? Math.round((activated / installed) * 100) : 0,
        ont_scanned: ontScanned,
        ups_scanned: upsScanned,
        serial_compliance_rate:
          installed > 0 ? Math.round((ontScanned / installed) * 100) : 0,
      };
    });

    // Query for team performance (from OES)
    const teamResult = await pool.query(
      `
      SELECT
        oes.team,
        qpr.project,
        COUNT(*) as total_activations,
        COUNT(*) FILTER (WHERE qpr.drop_number IS NOT NULL) as matched_to_wa
      FROM oes_activations oes
      LEFT JOIN qa_photo_reviews qpr ON oes.drop_number = qpr.drop_number
      WHERE oes.activation_date >= $1
        AND oes.activation_date <= $2
        AND ($3::TEXT IS NULL OR qpr.project = $3)
        AND oes.team IS NOT NULL
        AND oes.team != ''
      GROUP BY oes.team, qpr.project
      ORDER BY total_activations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    // Map team performance
    const teams: TeamPerformance[] = teamResult.rows.map((row) => {
      const total = parseInt(row.total_activations, 10) || 0;
      const matched = parseInt(row.matched_to_wa, 10) || 0;

      return {
        team: row.team,
        project: row.project,
        total_activations: total,
        matched_to_wa: matched,
        match_rate: total > 0 ? Math.round((matched / total) * 100) : 0,
      };
    });

    // Calculate summary
    const totalUsers = users.length;
    const totalTeams = teams.length;
    const avgReviewRate =
      users.length > 0
        ? Math.round(
            users.reduce((acc, u) => acc + u.review_rate, 0) / users.length
          )
        : 0;
    const avgSerialCompliance =
      users.length > 0
        ? Math.round(
            users.reduce((acc, u) => acc + u.serial_compliance_rate, 0) /
              users.length
          )
        : 0;

    return {
      date_range: { from: dateFrom, to: dateTo },
      users,
      teams,
      summary: {
        total_users: totalUsers,
        total_teams: totalTeams,
        avg_review_rate: avgReviewRate,
        avg_serial_compliance: avgSerialCompliance,
      },
    };
  } catch (error) {
    log.error('Failed to get user/team attribution report', {
      error,
    }, 'ReportingService');
    throw error;
  }
}
