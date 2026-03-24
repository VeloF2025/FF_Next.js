/**
 * API Route: /api/activate/reporting/installation-gaps
 *
 * Purpose: Report on DRs that are Installed but Not Activated
 * - Installed = WA submission OR 1Map has installer name
 * - Activated = Appeared on OES report
 * - Gap = Money spent, work done, but never went live
 *
 * Method: GET
 *
 * Query Parameters:
 * - project (optional): Filter by project name
 * - minDays (optional): Minimum days since install (default: 0)
 * - maxDays (optional): Maximum days since install (default: no limit)
 * - page (optional): Page number (default: 1)
 * - limit (optional): Items per page (default: 50)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

interface InstallationGapItem {
  drop_number: string;
  project: string | null;
  installer_name: string | null;
  install_source: 'whatsapp' | 'onemap' | 'both';
  wa_received_at: string | null;
  first_seen_at: string;
  days_since_install: number;
  photo_count: number;
  ont_serial: string | null;
  ups_serial: string | null;
  qa_decision: string | null;
  feedback_sent: boolean;
  activation_gap_reason: string | null;
}

interface InstallationGapsSummary {
  total_gaps: number;
  by_project: { project: string; count: number }[];
  by_age: {
    under_7_days: number;
    days_7_to_14: number;
    days_14_to_30: number;
    over_30_days: number;
  };
  by_source: {
    whatsapp: number;
    onemap: number;
    both: number;
  };
}

interface InstallationGapsResponse {
  success: boolean;
  summary: InstallationGapsSummary;
  items: InstallationGapItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InstallationGapsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  try {
    const {
      project,
      minDays = '0',
      maxDays,
      page = '1',
      limit = '50',
    } = req.query;

    const projectFilter = project ? (Array.isArray(project) ? project[0] : project) : null;
    const minDaysNum = parseInt(Array.isArray(minDays) ? minDays[0] : minDays, 10) || 0;
    const maxDaysNum = maxDays ? parseInt(Array.isArray(maxDays) ? maxDays[0] : maxDays, 10) : null;
    const pageNum = parseInt(Array.isArray(page) ? page[0] : page, 10) || 1;
    const limitNum = Math.min(parseInt(Array.isArray(limit) ? limit[0] : limit, 10) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    log.info('InstallationGapsAPI', 'Fetching installation gaps report', {
      project: projectFilter,
      minDays: minDaysNum,
      maxDays: maxDaysNum,
      page: pageNum,
      limit: limitNum,
    });

    // Build WHERE clause
    const conditions: string[] = [
      'u.oes_activated_at IS NULL', // Not activated
      '(u.wa_received_at IS NOT NULL OR u.installer_name IS NOT NULL)', // But installed
    ];
    const params: (string | number | null)[] = [];
    let paramIndex = 1;

    if (projectFilter) {
      conditions.push(`u.project = $${paramIndex}`);
      params.push(projectFilter);
      paramIndex++;
    }

    if (minDaysNum > 0) {
      conditions.push(`EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) >= $${paramIndex}`);
      params.push(minDaysNum);
      paramIndex++;
    }

    if (maxDaysNum !== null) {
      conditions.push(`EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) <= $${paramIndex}`);
      params.push(maxDaysNum);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get summary statistics
    const summaryResult = await pool.query(
      `SELECT
        COUNT(*) as total_gaps,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) < 7) as under_7_days,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) >= 7 AND EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) < 14) as days_7_to_14,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) >= 14 AND EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) < 30) as days_14_to_30,
        COUNT(*) FILTER (WHERE EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at)) >= 30) as over_30_days,
        COUNT(*) FILTER (WHERE u.wa_received_at IS NOT NULL AND u.installer_name IS NULL) as wa_only,
        COUNT(*) FILTER (WHERE u.wa_received_at IS NULL AND u.installer_name IS NOT NULL) as onemap_only,
        COUNT(*) FILTER (WHERE u.wa_received_at IS NOT NULL AND u.installer_name IS NOT NULL) as both_sources
      FROM dr_photo_unified_reviews u
      WHERE ${whereClause}`,
      params
    );

    const summaryRow = summaryResult.rows[0];

    // Get by-project breakdown
    const projectBreakdownResult = await pool.query(
      `SELECT
        COALESCE(u.project, 'Unknown') as project,
        COUNT(*) as count
      FROM dr_photo_unified_reviews u
      WHERE ${whereClause}
      GROUP BY u.project
      ORDER BY count DESC`,
      params
    );

    // Get paginated items
    const itemsResult = await pool.query(
      `SELECT
        u.drop_number,
        u.project,
        u.installer_name,
        u.wa_received_at,
        u.created_at as first_seen_at,
        EXTRACT(DAY FROM NOW() - COALESCE(u.wa_received_at, u.created_at))::integer as days_since_install,
        u.photo_count,
        u.ont_serial_scanned as ont_serial,
        u.ups_serial_scanned as ups_serial,
        u.qa_decision,
        COALESCE(u.feedback_sent, false) as feedback_sent,
        u.activation_gap_reason,
        CASE
          WHEN u.wa_received_at IS NOT NULL AND u.installer_name IS NOT NULL THEN 'both'
          WHEN u.wa_received_at IS NOT NULL THEN 'whatsapp'
          ELSE 'onemap'
        END as install_source
      FROM dr_photo_unified_reviews u
      WHERE ${whereClause}
      ORDER BY COALESCE(u.wa_received_at, u.created_at) DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limitNum, offset]
    );

    const response: InstallationGapsResponse = {
      success: true,
      summary: {
        total_gaps: parseInt(summaryRow.total_gaps, 10),
        by_project: projectBreakdownResult.rows.map(r => ({
          project: r.project,
          count: parseInt(r.count, 10),
        })),
        by_age: {
          under_7_days: parseInt(summaryRow.under_7_days, 10),
          days_7_to_14: parseInt(summaryRow.days_7_to_14, 10),
          days_14_to_30: parseInt(summaryRow.days_14_to_30, 10),
          over_30_days: parseInt(summaryRow.over_30_days, 10),
        },
        by_source: {
          whatsapp: parseInt(summaryRow.wa_only, 10),
          onemap: parseInt(summaryRow.onemap_only, 10),
          both: parseInt(summaryRow.both_sources, 10),
        },
      },
      items: itemsResult.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(summaryRow.total_gaps, 10),
        totalPages: Math.ceil(parseInt(summaryRow.total_gaps, 10) / limitNum),
      },
    };

    log.info('InstallationGapsAPI', 'Report generated', {
      totalGaps: response.summary.total_gaps,
      projectsAffected: response.summary.by_project.length,
    });

    return res.status(200).json(response);
  } catch (error) {
    log.error('InstallationGapsAPI', 'Failed to fetch installation gaps report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
