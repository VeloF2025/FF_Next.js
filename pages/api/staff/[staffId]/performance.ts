/**
 * API Route: /api/staff/[staffId]/performance
 *
 * Purpose: Get field performance metrics for a staff member
 * Links staff phone number to DR submissions
 *
 * Method: GET
 * Query Parameters:
 * - dateFrom (optional): Start date (YYYY-MM-DD), defaults to 30 days ago
 * - dateTo (optional): End date (YYYY-MM-DD), defaults to today
 *
 * @author Jarvis
 * @date 2026-02-01
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

export interface StaffPerformanceMetrics {
  staffId: string;
  staffName: string;
  phone: string | null;
  whatsappId: string | null;
  dateRange: {
    from: string;
    to: string;
  };
  summary: {
    totalSubmissions: number;
    firstPassSuccess: number;
    firstPassRate: number;
    resubmissions: number;
    resubmissionRate: number;
    ontScanned: number;
    upsScanned: number;
    serialComplianceRate: number;
    projectsWorked: string[];
    activeDays: number;
  };
  trend: {
    date: string;
    submissions: number;
    firstPass: number;
    resubmissions: number;
  }[];
  projectBreakdown: {
    project: string;
    submissions: number;
    firstPassRate: number;
    serialComplianceRate: number;
  }[];
  recentSubmissions: {
    dropNumber: string;
    project: string;
    submittedAt: string;
    submissionCount: number;
    qaDecision: string | null;
    feedbackSent: boolean;
  }[];
  comparisonToTeam: {
    metric: string;
    staffValue: number;
    teamAverage: number;
    percentile: number;
  }[];
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StaffPerformanceMetrics | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { staffId, dateFrom, dateTo } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'staffId is required' });
  }

  // Default date range: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const dateFromStr = typeof dateFrom === 'string' ? dateFrom : thirtyDaysAgo.toISOString().split('T')[0];
  const dateToStr = typeof dateTo === 'string' ? dateTo : today.toISOString().split('T')[0];

  try {
    log.info('StaffPerformanceAPI', `Fetching performance for staff ${staffId}`, {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
    });

    // Get staff details including phone number
    const staffResult = await pool.query(
      `SELECT id, name, phone, whatsapp_id FROM staff WHERE id = $1`,
      [staffId]
    );

    if (staffResult.rows.length === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }

    const staff = staffResult.rows[0];
    const staffPhone = staff.phone?.replace(/[^0-9]/g, ''); // Normalize phone

    if (!staffPhone) {
      return res.status(200).json({
        staffId: staff.id,
        staffName: staff.name,
        phone: staff.phone,
        whatsappId: staff.whatsapp_id,
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
        recentSubmissions: [],
        comparisonToTeam: [],
      });
    }

    // Get performance summary linked by phone number
    // Match last 10 digits of phone to sender_phone
    const summaryResult = await pool.query(
      `
      WITH staff_submissions AS (
        SELECT
          qpr.drop_number,
          qpr.project,
          upr.submission_count,
          upr.ont_serial_scanned,
          upr.ups_serial_scanned,
          upr.qa_decision,
          upr.feedback_sent,
          COALESCE(upr.submitted_date, upr.created_at::DATE) as submitted_date,
          upr.created_at
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $2::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $3::DATE
      )
      SELECT
        COUNT(DISTINCT drop_number) as total_submissions,
        COUNT(DISTINCT drop_number) FILTER (WHERE submission_count = 1) as first_pass_success,
        COUNT(DISTINCT drop_number) FILTER (WHERE submission_count > 1) as resubmissions,
        COUNT(DISTINCT drop_number) FILTER (WHERE ont_serial_scanned IS NOT NULL AND ont_serial_scanned != '') as ont_scanned,
        COUNT(DISTINCT drop_number) FILTER (WHERE ups_serial_scanned IS NOT NULL AND ups_serial_scanned != '') as ups_scanned,
        ARRAY_AGG(DISTINCT project) FILTER (WHERE project IS NOT NULL) as projects,
        COUNT(DISTINCT submitted_date) as active_days
      FROM staff_submissions
      `,
      [staffPhone, dateFromStr, dateToStr]
    );

    const summary = summaryResult.rows[0] || {};
    const totalSubmissions = parseInt(summary.total_submissions) || 0;
    const firstPassSuccess = parseInt(summary.first_pass_success) || 0;
    const resubmissions = parseInt(summary.resubmissions) || 0;
    const ontScanned = parseInt(summary.ont_scanned) || 0;

    // Get daily trend
    const trendResult = await pool.query(
      `
      WITH staff_submissions AS (
        SELECT
          COALESCE(upr.submitted_date, upr.created_at::DATE) as date_val,
          upr.submission_count
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $2::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $3::DATE
      )
      SELECT
        date_val::TEXT as date,
        COUNT(*) as submissions,
        COUNT(*) FILTER (WHERE submission_count = 1) as first_pass,
        COUNT(*) FILTER (WHERE submission_count > 1) as resubmissions
      FROM staff_submissions
      GROUP BY date_val
      ORDER BY date_val
      `,
      [staffPhone, dateFromStr, dateToStr]
    );

    // Get project breakdown
    const projectResult = await pool.query(
      `
      WITH staff_submissions AS (
        SELECT
          qpr.project,
          upr.submission_count,
          upr.ont_serial_scanned
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $2::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $3::DATE
          AND qpr.project IS NOT NULL
      )
      SELECT
        project,
        COUNT(*) as submissions,
        ROUND(COUNT(*) FILTER (WHERE submission_count = 1)::NUMERIC / NULLIF(COUNT(*), 0) * 100) as first_pass_rate,
        ROUND(COUNT(*) FILTER (WHERE ont_serial_scanned IS NOT NULL AND ont_serial_scanned != '')::NUMERIC / NULLIF(COUNT(*), 0) * 100) as serial_compliance_rate
      FROM staff_submissions
      GROUP BY project
      ORDER BY submissions DESC
      `,
      [staffPhone, dateFromStr, dateToStr]
    );

    // Get recent submissions
    const recentResult = await pool.query(
      `
      SELECT
        upr.drop_number,
        upr.project,
        upr.created_at as submitted_at,
        upr.submission_count,
        upr.qa_decision,
        upr.feedback_sent
      FROM qa_photo_reviews qpr
      INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
      WHERE RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) >= $2::DATE
        AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $3::DATE
      ORDER BY upr.created_at DESC
      LIMIT 20
      `,
      [staffPhone, dateFromStr, dateToStr]
    );

    // Get team comparison (all technicians in same date range)
    const teamResult = await pool.query(
      `
      WITH all_technicians AS (
        SELECT
          qpr.sender_phone,
          COUNT(DISTINCT qpr.drop_number) as total,
          COUNT(DISTINCT qpr.drop_number) FILTER (WHERE upr.submission_count = 1) as first_pass,
          COUNT(DISTINCT qpr.drop_number) FILTER (WHERE upr.ont_serial_scanned IS NOT NULL AND upr.ont_serial_scanned != '') as ont_scanned
        FROM qa_photo_reviews qpr
        INNER JOIN dr_photo_unified_reviews upr ON qpr.drop_number = upr.drop_number
        WHERE COALESCE(upr.submitted_date, upr.created_at::DATE) >= $1::DATE
          AND COALESCE(upr.submitted_date, upr.created_at::DATE) <= $2::DATE
          AND qpr.sender_phone IS NOT NULL
        GROUP BY qpr.sender_phone
        HAVING COUNT(DISTINCT qpr.drop_number) >= 5
      )
      SELECT
        AVG(total) as avg_submissions,
        AVG(CASE WHEN total > 0 THEN first_pass::NUMERIC / total * 100 ELSE 0 END) as avg_first_pass_rate,
        AVG(CASE WHEN total > 0 THEN ont_scanned::NUMERIC / total * 100 ELSE 0 END) as avg_serial_compliance,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total) as median_submissions,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN total > 0 THEN first_pass::NUMERIC / total * 100 ELSE 0 END) as median_first_pass_rate
      FROM all_technicians
      `,
      [dateFromStr, dateToStr]
    );

    const teamStats = teamResult.rows[0] || {};
    const teamAvgFirstPassRate = parseFloat(teamStats.avg_first_pass_rate) || 0;
    const teamAvgSerialCompliance = parseFloat(teamStats.avg_serial_compliance) || 0;
    const staffFirstPassRate = totalSubmissions > 0 ? (firstPassSuccess / totalSubmissions) * 100 : 0;
    const staffSerialCompliance = totalSubmissions > 0 ? (ontScanned / totalSubmissions) * 100 : 0;

    // Calculate percentile (simplified)
    const calculatePercentile = (staffValue: number, teamAvg: number) => {
      if (teamAvg === 0) return 50;
      const ratio = staffValue / teamAvg;
      return Math.min(99, Math.max(1, Math.round(ratio * 50)));
    };

    const response: StaffPerformanceMetrics = {
      staffId: staff.id,
      staffName: staff.name,
      phone: staff.phone,
      whatsappId: staff.whatsapp_id,
      dateRange: { from: dateFromStr, to: dateToStr },
      summary: {
        totalSubmissions,
        firstPassSuccess,
        firstPassRate: totalSubmissions > 0 ? Math.round(staffFirstPassRate) : 0,
        resubmissions,
        resubmissionRate: totalSubmissions > 0 ? Math.round((resubmissions / totalSubmissions) * 100) : 0,
        ontScanned,
        upsScanned: parseInt(summary.ups_scanned) || 0,
        serialComplianceRate: totalSubmissions > 0 ? Math.round(staffSerialCompliance) : 0,
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
      recentSubmissions: recentResult.rows.map((r) => ({
        dropNumber: r.drop_number,
        project: r.project || 'Unknown',
        submittedAt: r.submitted_at ? new Date(r.submitted_at).toISOString() : '',
        submissionCount: parseInt(r.submission_count) || 1,
        qaDecision: r.qa_decision,
        feedbackSent: r.feedback_sent || false,
      })),
      comparisonToTeam: [
        {
          metric: 'First Pass Rate',
          staffValue: Math.round(staffFirstPassRate),
          teamAverage: Math.round(teamAvgFirstPassRate),
          percentile: calculatePercentile(staffFirstPassRate, teamAvgFirstPassRate),
        },
        {
          metric: 'Serial Compliance',
          staffValue: Math.round(staffSerialCompliance),
          teamAverage: Math.round(teamAvgSerialCompliance),
          percentile: calculatePercentile(staffSerialCompliance, teamAvgSerialCompliance),
        },
        {
          metric: 'Total Submissions',
          staffValue: totalSubmissions,
          teamAverage: Math.round(parseFloat(teamStats.avg_submissions) || 0),
          percentile: calculatePercentile(totalSubmissions, parseFloat(teamStats.avg_submissions) || 1),
        },
      ],
    };

    log.info('StaffPerformanceAPI', `Found ${totalSubmissions} submissions for ${staff.name}`);

    return res.status(200).json(response);
  } catch (error) {
    log.error('StaffPerformanceAPI', 'Failed to fetch staff performance', { error, staffId });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
