/**
 * Enhanced Team Performance Report
 */

import { log } from '@/lib/logger';
import { pool } from './_shared';
import type {
  TeamPerformanceResponse,
  TechnicianLeaderboardEntry,
  InstallerLeaderboardEntry,
  TeamComparisonEntry,
  ComplianceMetrics,
} from '../../types/reporting.types';

/**
 * Get enhanced team performance report with leaderboard
 */
export async function getTeamPerformanceReport(
  dateFrom: string,
  dateTo: string,
  project?: string
): Promise<TeamPerformanceResponse> {
  try {
    log.info('ReportingService', 'Getting team performance report', {
      dateFrom,
      dateTo,
      project,
    });

    // Get leaderboard data (activators from WhatsApp)
    // Uses wa_contacts to get formal_name if mapped, otherwise falls back to user_name
    const leaderboardResult = await pool.query(
      `
      SELECT
        COALESCE(wc.formal_name, wc.wa_display_name, qpr.user_name) as user_name,
        qpr.sender_phone,
        wc.team,
        wc.role,
        ARRAY_AGG(DISTINCT qpr.project) FILTER (WHERE qpr.project IS NOT NULL) as projects,
        COUNT(*) as total_submissions,
        COUNT(*) FILTER (WHERE upr.submission_count = 1) as first_pass_success,
        COUNT(*) FILTER (WHERE upr.submission_count > 1) as resubmissions,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned,
        COUNT(*) FILTER (WHERE upr.ups_serial_scanned IS NOT NULL AND upr.ups_serial_scanned != '') as ups_scanned
      FROM qa_photo_reviews qpr
      LEFT JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      LEFT JOIN wa_contacts wc ON qpr.sender_phone = wc.sender_phone
      WHERE COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE >= $1::DATE
        AND COALESCE(qpr.whatsapp_message_date, qpr.created_at)::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR qpr.project = $3)
      GROUP BY COALESCE(wc.formal_name, wc.wa_display_name, qpr.user_name), qpr.sender_phone, wc.team, wc.role
      ORDER BY total_submissions DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const leaderboard: TechnicianLeaderboardEntry[] = leaderboardResult.rows.map((row, idx) => {
      const total = parseInt(row.total_submissions, 10) || 0;
      const firstPass = parseInt(row.first_pass_success, 10) || 0;
      const resubs = parseInt(row.resubmissions, 10) || 0;
      const ont = parseInt(row.ont_scanned, 10) || 0;
      const ups = parseInt(row.ups_scanned, 10) || 0;

      return {
        rank: idx + 1,
        user_name: row.user_name,
        sender_phone: row.sender_phone,
        team: row.team || null,
        role: row.role || 'activator',
        projects: row.projects || [],
        total_submissions: total,
        first_pass_success: firstPass,
        first_pass_rate: total > 0 ? Math.round((firstPass / total) * 100) : 0,
        resubmissions: resubs,
        resubmission_rate: total > 0 ? Math.round((resubs / total) * 100) : 0,
        ont_scanned: ont,
        ups_scanned: ups,
        serial_compliance: total > 0 ? Math.round((ont / total) * 100) : 0,
        avg_quality_score: null,
        trend_7d: [], // Would need daily breakdown
      };
    });

    // Get installer leaderboard from drops (1Map data)
    const installerResult = await pool.query(
      `
      SELECT
        d.installed_by_name as installer_name,
        ARRAY_AGG(DISTINCT p.project_name) FILTER (WHERE p.project_name IS NOT NULL) as projects,
        COUNT(DISTINCT d.drop_number) as total_installations,
        COUNT(DISTINCT d.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as has_wa_submission,
        COUNT(DISTINCT d.drop_number) FILTER (WHERE oes.drop_number IS NOT NULL) as is_activated
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
      LEFT JOIN oes_activations oes ON d.drop_number = oes.drop_number
      WHERE d.installed_by_name IS NOT NULL
        AND d.installed_by_name != ''
        AND d.installed_at >= $1::DATE
        AND d.installed_at <= $2::DATE
        AND ($3::TEXT IS NULL OR p.project_name = $3)
      GROUP BY d.installed_by_name
      ORDER BY total_installations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const installerLeaderboard: InstallerLeaderboardEntry[] = installerResult.rows.map((row, idx) => {
      const total = parseInt(row.total_installations, 10) || 0;
      const hasWa = parseInt(row.has_wa_submission, 10) || 0;
      const activated = parseInt(row.is_activated, 10) || 0;

      return {
        rank: idx + 1,
        installer_name: row.installer_name,
        projects: row.projects || [],
        total_installations: total,
        has_wa_submission: hasWa,
        wa_submission_rate: total > 0 ? Math.round((hasWa / total) * 100) : 0,
        is_activated: activated,
        activation_rate: total > 0 ? Math.round((activated / total) * 100) : 0,
      };
    });

    // Get team comparison from OES
    const teamsResult = await pool.query(
      `
      SELECT
        oes.team,
        ARRAY_AGG(DISTINCT upr.project) FILTER (WHERE upr.project IS NOT NULL) as projects,
        COUNT(DISTINCT oes.drop_number) as total_activations,
        COUNT(DISTINCT oes.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as matched_to_wa,
        AVG(oes.ont_rx_sig_dbm) as avg_ont_signal,
        AVG(oes.olt_rx_sig_dbm) as avg_olt_signal
      FROM oes_activations oes
      LEFT JOIN dr_photo_unified_reviews upr ON oes.drop_number = upr.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
        AND oes.team IS NOT NULL
        AND oes.team != ''
      GROUP BY oes.team
      ORDER BY total_activations DESC
      `,
      [dateFrom, dateTo, project || null]
    );

    const teams: TeamComparisonEntry[] = teamsResult.rows.map((row) => {
      const total = parseInt(row.total_activations, 10) || 0;
      const matched = parseInt(row.matched_to_wa, 10) || 0;

      return {
        team: row.team,
        projects: row.projects || [],
        total_activations: total,
        matched_to_wa: matched,
        wa_match_rate: total > 0 ? Math.round((matched / total) * 100) : 0,
        avg_activation_time: null, // Would need timestamps
        avg_ont_signal: row.avg_ont_signal ? parseFloat(row.avg_ont_signal) : null,
        avg_olt_signal: row.avg_olt_signal ? parseFloat(row.avg_olt_signal) : null,
      };
    });

    // Get compliance metrics
    const complianceResult = await pool.query(
      `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as serial_scanned,
        COUNT(*) FILTER (WHERE
          step_01_house_photo IS NOT NULL AND step_02_cable_from_pole IS NOT NULL AND step_03_entry_outside IS NOT NULL AND
          step_04_entry_inside IS NOT NULL AND step_05_wall IS NOT NULL AND step_06_ont_back IS NOT NULL AND
          step_07_power_meter IS NOT NULL AND step_08_final_installation IS NOT NULL AND step_09_green_lights IS NOT NULL AND
          step_10_signature IS NOT NULL
        ) as photo_complete
      FROM dr_photo_unified_reviews upr
      WHERE upr.created_at::DATE >= $1::DATE
        AND upr.created_at::DATE <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3)
      `,
      [dateFrom, dateTo, project || null]
    );

    const compRow = complianceResult.rows[0] || {};
    const compTotal = parseInt(compRow.total, 10) || 1;

    // Get WA submission compliance (activations with WA submission)
    const waCompResult = await pool.query(
      `
      SELECT
        COUNT(DISTINCT oes.drop_number) as total_activated,
        COUNT(DISTINCT oes.drop_number) FILTER (WHERE upr.drop_number IS NOT NULL) as with_wa
      FROM oes_activations oes
      LEFT JOIN dr_photo_unified_reviews upr ON oes.drop_number = upr.drop_number
      WHERE oes.activation_date >= $1::DATE
        AND oes.activation_date <= $2::DATE
        AND ($3::TEXT IS NULL OR upr.project = $3 OR upr.project IS NULL)
      `,
      [dateFrom, dateTo, project || null]
    );

    const waCompRow = waCompResult.rows[0] || {};
    const totalActivated = parseInt(waCompRow.total_activated, 10) || 1;
    const withWa = parseInt(waCompRow.with_wa, 10) || 0;

    const compliance: ComplianceMetrics = {
      wa_submission_compliance: Math.round((withWa / totalActivated) * 100),
      serial_scan_compliance: Math.round(
        (parseInt(compRow.serial_scanned, 10) || 0) / compTotal * 100
      ),
      photo_completion_compliance: Math.round(
        (parseInt(compRow.photo_complete, 10) || 0) / compTotal * 100
      ),
      targets: {
        wa_submission: 95,
        serial_scan: 90,
        photo_completion: 85,
      },
    };

    // Calculate summary
    const avgFirstPass =
      leaderboard.length > 0
        ? Math.round(leaderboard.reduce((sum, t) => sum + t.first_pass_rate, 0) / leaderboard.length)
        : 0;
    const avgSerial =
      leaderboard.length > 0
        ? Math.round(leaderboard.reduce((sum, t) => sum + t.serial_compliance, 0) / leaderboard.length)
        : 0;
    const topPerformer = leaderboard[0]?.user_name || null;
    const topInstaller = installerLeaderboard[0]?.installer_name || null;

    return {
      date_range: { from: dateFrom, to: dateTo },
      project: project || null,
      leaderboard,
      installerLeaderboard,
      teams,
      compliance,
      summary: {
        total_technicians: leaderboard.length,
        total_installers: installerLeaderboard.length,
        total_teams: teams.length,
        avg_first_pass_rate: avgFirstPass,
        avg_serial_compliance: avgSerial,
        top_performer: topPerformer,
        top_installer: topInstaller,
      },
    };
  } catch (error) {
    log.error('ReportingService', 'Failed to get team performance report', { error });
    throw error;
  }
}
