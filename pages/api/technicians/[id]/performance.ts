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
import { Pool } from 'pg';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { TechnicianPerformance } from '@/types/technician.types';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : undefined,
});

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
  
  const dateFromStr = typeof dateFrom === 'string' ? dateFrom : thirtyDaysAgo.toISOString().split('T')[0];
  const dateToStr = typeof dateTo === 'string' ? dateTo : today.toISOString().split('T')[0];

  try {
    // Get technician details
    const techResult = await pool.query(
      `SELECT * FROM technicians WHERE id = $1`,
      [id]
    );

    if (techResult.rows.length === 0) {
      return res.status(404).json({ error: 'Technician not found' });
    }

    const tech = techResult.rows[0];
    const waSenderJid = tech.wa_sender_jid;
    const phone = tech.phone?.replace(/[^0-9]/g, '');

    if (!waSenderJid && !phone) {
      return res.status(200).json({
        technicianId: tech.id,
        technicianName: tech.name,
        type: tech.type,
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
      });
    }

    // Build the WHERE clause to match by wa_sender_jid OR phone
    const matchConditions = [];
    const matchParams = [dateFromStr, dateToStr];
    let paramIdx = 3;

    if (waSenderJid) {
      matchConditions.push(`qpr.wa_sender_jid = $${paramIdx++}`);
      matchParams.push(waSenderJid);
    }
    if (phone) {
      matchConditions.push(`RIGHT(REGEXP_REPLACE(qpr.sender_phone, '[^0-9]', '', 'g'), 10) = RIGHT($${paramIdx++}, 10)`);
      matchParams.push(phone);
    }

    const matchClause = matchConditions.length > 0 
      ? `(${matchConditions.join(' OR ')})` 
      : '1=0';

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

    // Get daily trend
    const trendResult = await pool.query(
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
    );

    // Get project breakdown
    const projectResult = await pool.query(
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
    );

    const response: TechnicianPerformance = {
      technicianId: tech.id,
      technicianName: tech.name,
      type: tech.type,
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
    };

    return res.status(200).json(response);
  } catch (error) {
    log.error('TechnicianPerformanceAPI', 'Failed to fetch performance', { error, id });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
