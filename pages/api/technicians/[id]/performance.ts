/**
 * API Route: /api/technicians/[id]/performance
 * 
 * Get field performance metrics for a technician
 * Links via phone number or wa_sender_jid to DR submissions
 * 
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type {
  TechnicianPerformance,
  ActivatorPerformance,
  InstallerPerformance
} from '@/types/technician.types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, dateFrom, dateTo } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id is required' });
  }

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const dateFromStr: string = typeof dateFrom === 'string' ? dateFrom : (thirtyDaysAgo.toISOString().split('T')[0] ?? '');
  const dateToStr: string = typeof dateTo === 'string' ? dateTo : (today.toISOString().split('T')[0] ?? '');

  try {
    // Get technician details from wa_contacts table
    const techResult = await pool.query(
      `SELECT
        id,
        sender_phone,
        COALESCE(formal_name, wa_display_name, sender_phone) as name,
        role as type,
        team,
        projects,
        is_active
      FROM wa_contacts
      WHERE id = $1`,
      [id]
    );

    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }

    const tech = techResult.rows[0];

    // Route to appropriate handler based on technician type
    if (tech.type === 'installer') {
      return getInstallerPerformance(res, tech, dateFromStr, dateToStr);
    }

    // Default: activator performance
    return getActivatorPerformance(res, tech, dateFromStr, dateToStr);
  } catch (error) {
    log.error('TechnicianPerformanceAPI', 'Failed to fetch performance', { error, id });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

/**
 * Get performance metrics for an activator (DR photo submitter)
 */
async function getActivatorPerformance(
  res: NextApiResponse,
  tech: { id: string; name: string; sender_phone: string | null },
  dateFromStr: string,
  dateToStr: string
) {
  const identifier = tech.sender_phone;

  if (!identifier) {
    return res.status(200).json({
      technicianId: tech.id,
      technicianName: tech.name,
      type: 'activator',
      dateRange: { from: dateFromStr, to: dateToStr },
      summary: {
        totalSubmissions: 0,
        firstPassSuccess: 0,
        firstPassRate: 0,
        resubmissions: 0,
        resubmissionRate: 0,
        ontScanned: 0,
        upsScanned: 0,
        serialComplianceRate: 0,
        projectsWorked: [],
        activeDays: 0,
      },
      trend: [],
      projectBreakdown: [],
      recentDRs: [],
    } as ActivatorPerformance);
  }

  const matchParams = [dateFromStr, dateToStr, identifier];
  const matchClause = `qpr.user_name = $3`;

  // Get performance summary
  const summaryResult = await pool.query(
    `
    WITH tech_submissions AS (
      SELECT
        qpr.drop_number,
        qpr.project,
        upr.submission_count,
        upr.ont_serial_scanned,
        upr.ups_serial_scanned,
        COALESCE(upr.submitted_date, upr.created_at::DATE) as submitted_date
      FROM qa_photo_reviews qpr
      INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      WHERE ${matchClause}
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
    )
    SELECT
      COUNT(DISTINCT drop_number) as total_submissions,
      COUNT(DISTINCT drop_number) FILTER (WHERE submission_count = 1) as first_pass_success,
      COUNT(DISTINCT drop_number) FILTER (WHERE submission_count > 1) as resubmissions,
      COUNT(DISTINCT drop_number) FILTER (WHERE ont_serial_scanned IS NOT NULL AND ont_serial_scanned != '') as ont_scanned,
      COUNT(DISTINCT drop_number) FILTER (WHERE ups_serial_scanned IS NOT NULL AND ups_serial_scanned != '') as ups_scanned,
      ARRAY_AGG(DISTINCT project) FILTER (WHERE project IS NOT NULL) as projects,
      COUNT(DISTINCT submitted_date) as active_days
    FROM tech_submissions
    `,
    matchParams
  );

  const summary = summaryResult.rows[0] || {};
  const totalSubmissions = parseInt(summary.total_submissions) || 0;
  const firstPassSuccess = parseInt(summary.first_pass_success) || 0;
  const resubmissions = parseInt(summary.resubmissions) || 0;
  const ontScanned = parseInt(summary.ont_scanned) || 0;
  const upsScanned = parseInt(summary.ups_scanned) || 0;

  // Trend, project breakdown, and recent DRs are all independent — run in parallel
  const [trendResult, projectResult, recentDRsResult] = await Promise.all([
    pool.query(
      `
      WITH tech_submissions AS (
        SELECT
          COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
          upr.submission_count
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE ${matchClause}
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
      )
      SELECT
        date_val::TEXT as date,
        COUNT(*) as submissions,
        COUNT(*) FILTER (WHERE submission_count = 1) as first_pass,
        COUNT(*) FILTER (WHERE submission_count > 1) as resubmissions
      FROM tech_submissions
      GROUP BY date_val
      ORDER BY date_val
      `,
      matchParams
    ),
    pool.query(
      `
      WITH tech_submissions AS (
        SELECT
          qpr.project,
          upr.submission_count,
          upr.ont_serial_scanned
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE ${matchClause}
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
          AND qpr.project IS NOT NULL
      )
      SELECT
        project,
        COUNT(*) as submissions,
        ROUND(COUNT(*) FILTER (WHERE submission_count = 1)::NUMERIC / NULLIF(COUNT(*), 0) * 100) as first_pass_rate,
        ROUND(COUNT(*) FILTER (WHERE ont_serial_scanned IS NOT NULL AND ont_serial_scanned != '')::NUMERIC / NULLIF(COUNT(*), 0) * 100) as serial_compliance_rate
      FROM tech_submissions
      GROUP BY project
      ORDER BY submissions DESC
      `,
      matchParams
    ),
    pool.query(
      `
      SELECT DISTINCT ON (qpr.drop_number)
        qpr.drop_number,
        qpr.project,
        COALESCE(upr.submitted_date, upr.created_at::DATE)::TEXT as date,
        upr.submission_count,
        upr.qa_decision
      FROM qa_photo_reviews qpr
      INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      WHERE ${matchClause}
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
      ORDER BY qpr.drop_number, COALESCE(upr.submitted_date, upr.created_at::DATE) DESC
      LIMIT 50
      `,
      matchParams
    ),
  ]);

  const response: ActivatorPerformance = {
    technicianId: tech.id,
    technicianName: tech.name,
    type: 'activator',
    dateRange: { from: dateFromStr, to: dateToStr },
    summary: {
      totalSubmissions,
      firstPassSuccess,
      firstPassRate: totalSubmissions > 0 ? Math.round((firstPassSuccess / totalSubmissions) * 100) : 0,
      resubmissions,
      resubmissionRate: totalSubmissions > 0 ? Math.round((resubmissions / totalSubmissions) * 100) : 0,
      ontScanned,
      upsScanned,
      serialComplianceRate: totalSubmissions > 0 ? Math.round((ontScanned / totalSubmissions) * 100) : 0,
      projectsWorked: summary.projects || [],
      activeDays: parseInt(summary.active_days) || 0,
    },
    trend: trendResult.rows.map((r) => ({
      date: r.date,
      submissions: parseInt(r.submissions) || 0,
      firstPass: parseInt(r.first_pass) || 0,
      resubmissions: parseInt(r.resubmissions) || 0,
    })),
    projectBreakdown: projectResult.rows.map((r) => ({
      project: r.project,
      submissions: parseInt(r.submissions) || 0,
      firstPassRate: parseInt(r.first_pass_rate) || 0,
      serialComplianceRate: parseInt(r.serial_compliance_rate) || 0,
    })),
    recentDRs: recentDRsResult.rows.map((r) => ({
      dropNumber: r.drop_number,
      project: r.project,
      date: r.date,
      submissionCount: parseInt(r.submission_count) || 1,
      qaDecision: r.qa_decision,
    })),
  };

  return res.status(200).json(response);
}

/**
 * Get performance metrics for an installer (based on QA review outcomes)
 */
async function getInstallerPerformance(
  res: NextApiResponse,
  tech: { id: string; name: string; sender_phone: string | null },
  dateFromStr: string,
  dateToStr: string
) {
  // For installers, we match by formal_name against drops.installed_by_name
  const installerName = tech.name;

  if (!installerName) {
    return res.status(200).json({
      technicianId: tech.id,
      technicianName: tech.name,
      type: 'installer',
      dateRange: { from: dateFromStr, to: dateToStr },
      summary: {
        totalInstallations: 0,
        qaPassedCount: 0,
        qaPassRate: 0,
        qaFailedCount: 0,
        reworkCount: 0,
        reworkRate: 0,
        avgStepsCompliance: 0,
        activatedCount: 0,
        activationRate: 0,
        avgDbReading: null,
        dbInRangeCount: 0,
        dbInRangeRate: 0,
        projectsWorked: [],
        activeDays: 0,
      },
      trend: [],
      projectBreakdown: [],
      commonFailures: [],
      recentDRs: [],
    } as InstallerPerformance);
  }

  const matchParams = [dateFromStr, dateToStr, installerName];

  // Get performance summary with 10-step compliance and dB metrics
  const summaryResult = await pool.query(
    `
    WITH installer_data AS (
      SELECT
        d.drop_number,
        p.project_name,
        d.created_at::DATE as install_date,
        upr.qa_decision,
        d.oes_confirmed,
        upr.vlm_power_meter_dbm,
        -- Count steps passed (10 boolean step columns)
        (
          CASE WHEN upr.step_01_house_photo THEN 1 ELSE 0 END +
          CASE WHEN upr.step_02_cable_from_pole THEN 1 ELSE 0 END +
          CASE WHEN upr.step_03_entry_outside THEN 1 ELSE 0 END +
          CASE WHEN upr.step_04_entry_inside THEN 1 ELSE 0 END +
          CASE WHEN upr.step_05_wall THEN 1 ELSE 0 END +
          CASE WHEN upr.step_06_ont_back THEN 1 ELSE 0 END +
          CASE WHEN upr.step_07_power_meter THEN 1 ELSE 0 END +
          CASE WHEN upr.step_08_final_installation THEN 1 ELSE 0 END +
          CASE WHEN upr.step_09_green_lights THEN 1 ELSE 0 END +
          CASE WHEN upr.step_10_signature THEN 1 ELSE 0 END
        ) as steps_passed
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
      WHERE d.installed_by_name = $3
        AND d.created_at >= $1::DATE
        AND d.created_at <= $2::DATE
    )
    SELECT
      COUNT(DISTINCT drop_number) as total_installations,
      COUNT(DISTINCT drop_number) FILTER (WHERE qa_decision = 'PASS') as qa_passed,
      COUNT(DISTINCT drop_number) FILTER (WHERE qa_decision = 'FAIL') as qa_failed,
      COUNT(DISTINCT drop_number) FILTER (WHERE qa_decision = 'REWORK_NEEDED') as rework,
      COALESCE(ROUND(AVG(steps_passed) / 10.0 * 100), 0) as avg_steps_compliance,
      COUNT(DISTINCT drop_number) FILTER (WHERE oes_confirmed = true) as activated,
      -- Signal quality metrics (valid range: -18 to -24 dBm)
      ROUND(AVG(vlm_power_meter_dbm)::NUMERIC, 1) as avg_db_reading,
      COUNT(DISTINCT drop_number) FILTER (WHERE vlm_power_meter_dbm IS NOT NULL AND vlm_power_meter_dbm BETWEEN -24 AND -18) as db_in_range,
      COUNT(DISTINCT drop_number) FILTER (WHERE vlm_power_meter_dbm IS NOT NULL) as db_readings_count,
      ARRAY_AGG(DISTINCT project_name) FILTER (WHERE project_name IS NOT NULL) as projects,
      COUNT(DISTINCT install_date) as active_days
    FROM installer_data
    `,
    matchParams
  );

  const summary = summaryResult.rows[0] || {};
  const totalInstallations = parseInt(summary.total_installations) || 0;
  const qaPassedCount = parseInt(summary.qa_passed) || 0;
  const qaFailedCount = parseInt(summary.qa_failed) || 0;
  const reworkCount = parseInt(summary.rework) || 0;
  const activatedCount = parseInt(summary.activated) || 0;
  const avgDbReading = summary.avg_db_reading ? parseFloat(summary.avg_db_reading) : null;
  const dbInRangeCount = parseInt(summary.db_in_range) || 0;
  const dbReadingsCount = parseInt(summary.db_readings_count) || 0;

  // Trend, project breakdown, common failures, and recent DRs are all independent — run in parallel
  const [trendResult, projectResult, failuresResult, recentDRsResult] = await Promise.all([
    pool.query(
      `
      WITH installer_data AS (
        SELECT
          d.created_at::DATE as date_val,
          upr.qa_decision
        FROM drops d
        LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
        WHERE d.installed_by_name = $3
          AND d.created_at >= $1::DATE
          AND d.created_at <= $2::DATE
      )
      SELECT
        date_val::TEXT as date,
        COUNT(*) as installations,
        COUNT(*) FILTER (WHERE qa_decision = 'PASS') as passed,
        COUNT(*) FILTER (WHERE qa_decision IN ('FAIL', 'REWORK_NEEDED')) as failed
      FROM installer_data
      GROUP BY date_val
      ORDER BY date_val
      `,
      matchParams
    ),
    pool.query(
      `
      WITH installer_data AS (
        SELECT
          p.project_name,
          upr.qa_decision
        FROM drops d
        LEFT JOIN projects p ON d.project_id = p.id
        LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
        WHERE d.installed_by_name = $3
          AND d.created_at >= $1::DATE
          AND d.created_at <= $2::DATE
          AND p.project_name IS NOT NULL
      )
      SELECT
        project_name as project,
        COUNT(*) as installations,
        ROUND(COUNT(*) FILTER (WHERE qa_decision = 'PASS')::NUMERIC / NULLIF(COUNT(*), 0) * 100) as qa_pass_rate
      FROM installer_data
      GROUP BY project_name
      ORDER BY installations DESC
      `,
      matchParams
    ),
    pool.query(
      `
      WITH step_failures AS (
        SELECT
          CASE WHEN NOT COALESCE(upr.step_01_house_photo, false) THEN 'House Photo' END as step_01,
          CASE WHEN NOT COALESCE(upr.step_02_cable_from_pole, false) THEN 'Cable from Pole' END as step_02,
          CASE WHEN NOT COALESCE(upr.step_03_entry_outside, false) THEN 'Entry Outside' END as step_03,
          CASE WHEN NOT COALESCE(upr.step_04_entry_inside, false) THEN 'Entry Inside' END as step_04,
          CASE WHEN NOT COALESCE(upr.step_05_wall, false) THEN 'Wall Installation' END as step_05,
          CASE WHEN NOT COALESCE(upr.step_06_ont_back, false) THEN 'ONT Back' END as step_06,
          CASE WHEN NOT COALESCE(upr.step_07_power_meter, false) THEN 'Power Meter' END as step_07,
          CASE WHEN NOT COALESCE(upr.step_08_final_installation, false) THEN 'Final Installation' END as step_08,
          CASE WHEN NOT COALESCE(upr.step_09_green_lights, false) THEN 'Green Lights' END as step_09,
          CASE WHEN NOT COALESCE(upr.step_10_signature, false) THEN 'Signature' END as step_10
        FROM drops d
        INNER JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
        WHERE d.installed_by_name = $3
          AND d.created_at >= $1::DATE
          AND d.created_at <= $2::DATE
      ),
      unpivoted AS (
        SELECT step FROM step_failures, LATERAL (
          VALUES (step_01), (step_02), (step_03), (step_04), (step_05),
                 (step_06), (step_07), (step_08), (step_09), (step_10)
        ) AS t(step)
        WHERE step IS NOT NULL
      )
      SELECT step, COUNT(*) as fail_count
      FROM unpivoted
      GROUP BY step
      ORDER BY fail_count DESC
      LIMIT 5
      `,
      matchParams
    ),
    pool.query(
      `
      SELECT DISTINCT ON (d.drop_number)
        d.drop_number,
        p.project_name as project,
        d.created_at::DATE::TEXT as date,
        upr.qa_decision
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      LEFT JOIN dr_photo_unified_reviews upr ON d.drop_number = upr.drop_number
      WHERE d.installed_by_name = $3
        AND d.created_at >= $1::DATE
        AND d.created_at <= $2::DATE
      ORDER BY d.drop_number, d.created_at DESC
      LIMIT 50
      `,
      matchParams
    ),
  ]);

  const response: InstallerPerformance = {
    technicianId: tech.id,
    technicianName: tech.name,
    type: 'installer',
    dateRange: { from: dateFromStr, to: dateToStr },
    summary: {
      totalInstallations,
      qaPassedCount,
      qaPassRate: totalInstallations > 0 ? Math.round((qaPassedCount / totalInstallations) * 100) : 0,
      qaFailedCount,
      reworkCount,
      reworkRate: totalInstallations > 0 ? Math.round((reworkCount / totalInstallations) * 100) : 0,
      avgStepsCompliance: parseInt(summary.avg_steps_compliance) || 0,
      activatedCount,
      activationRate: totalInstallations > 0 ? Math.round((activatedCount / totalInstallations) * 100) : 0,
      // Signal quality metrics
      avgDbReading,
      dbInRangeCount,
      dbInRangeRate: dbReadingsCount > 0 ? Math.round((dbInRangeCount / dbReadingsCount) * 100) : 0,
      projectsWorked: summary.projects || [],
      activeDays: parseInt(summary.active_days) || 0,
    },
    trend: trendResult.rows.map((r) => ({
      date: r.date,
      installations: parseInt(r.installations) || 0,
      passed: parseInt(r.passed) || 0,
      failed: parseInt(r.failed) || 0,
    })),
    projectBreakdown: projectResult.rows.map((r) => ({
      project: r.project,
      installations: parseInt(r.installations) || 0,
      qaPassRate: parseInt(r.qa_pass_rate) || 0,
    })),
    commonFailures: failuresResult.rows.map((r) => ({
      step: r.step,
      failCount: parseInt(r.fail_count) || 0,
    })),
    recentDRs: recentDRsResult.rows.map((r) => ({
      dropNumber: r.drop_number,
      project: r.project,
      date: r.date,
      qaDecision: r.qa_decision,
    })),
  };

  return res.status(200).json(response);
}

export default withAuth(handler);
