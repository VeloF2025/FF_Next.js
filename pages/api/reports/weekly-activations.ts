/**
 * API Route: /api/reports/weekly-activations
 *
 * Purpose: Group OES activations by ISO week and project for the executive dashboard
 * Method: GET
 *
 * Returns activations grouped by week (newest first), then by project within each week.
 * Only includes active projects.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';

export interface ProjectRow {
  project_id: string;
  project_name: string;
  count: number;
}

export interface WeekRow {
  week_start: string;  // ISO date e.g. "2026-01-05"
  week_label: string;  // e.g. "05 Jan – 11 Jan 2026"
  total: number;
  projects: ProjectRow[];
}

export interface WeeklyActivationsResponse {
  weeks: WeekRow[];
}

interface DbRow {
  week_start: string;
  project_id: string;
  project_name: string;
  count: string; // pg returns bigint as string
}

function buildWeekLabel(weekStart: string): string {
  // week_start is the Monday of the ISO week (DATE_TRUNC('week', ...))
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  const dayMonthOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', timeZone: 'UTC' };
  const yearOpts: Intl.DateTimeFormatOptions = { year: 'numeric', timeZone: 'UTC' };

  const startStr = start.toLocaleDateString('en-GB', dayMonthOpts);
  const endStr = end.toLocaleDateString('en-GB', dayMonthOpts);
  const year = end.toLocaleDateString('en-GB', yearOpts);

  return `${startStr} – ${endStr} ${year}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const client = await pool.connect();
  try {
    const result = await client.query<DbRow>(`
      SELECT
        DATE_TRUNC('week', oes.activation_date)::date::text AS week_start,
        p.id::text AS project_id,
        p.project_name,
        COUNT(DISTINCT oes.drop_number) AS count
      FROM oes_activations oes
      JOIN drops d ON d.drop_number = oes.drop_number
      JOIN projects p ON p.id = d.project_id
      WHERE p.status = 'active'
        AND oes.activation_date IS NOT NULL
      GROUP BY DATE_TRUNC('week', oes.activation_date), p.id, p.project_name
      ORDER BY DATE_TRUNC('week', oes.activation_date) DESC, p.project_name ASC
    `);

    // Group flat rows by week_start — order is already DESC from SQL
    const weekMap = new Map<string, WeekRow>();
    for (const row of result.rows) {
      const cnt = Number(row.count);

      if (!weekMap.has(row.week_start)) {
        weekMap.set(row.week_start, {
          week_start: row.week_start,
          week_label: buildWeekLabel(row.week_start),
          total: 0,
          projects: [],
        });
      }

      const week = weekMap.get(row.week_start)!;
      week.total += cnt;
      week.projects.push({
        project_id: row.project_id,
        project_name: row.project_name,
        count: cnt,
      });
    }

    const weeks = Array.from(weekMap.values());

    log.info('Fetched weekly activations', { error: { weekCount: weeks.length } }, 'WeeklyActivationsAPI');
    return apiResponse.success(res, { weeks } as WeeklyActivationsResponse);
  } catch (error) {
    log.error('Failed to fetch weekly activations', { error: { error } }, 'WeeklyActivationsAPI');
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withPermission('analytics.read')(handler));
