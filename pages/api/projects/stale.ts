import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

/**
 * Stale Projects API
 * GET /api/projects/stale?days=7
 *
 * Returns active projects with no updates in the last N days.
 * Used by the Stale Projects Alert Widget on the dashboard.
 *
 * Stale thresholds:
 *   7-14 days  → warning (amber)
 *   14+ days   → critical (red)
 */

export interface StaleProject {
  id: string;
  project_name: string;
  project_code: string | null;
  status: string;
  updated_at: string;
  client_name: string | null;
  days_stale: number;
  severity: 'warning' | 'critical';
}

export interface StaleProjectsResponse {
  projects: StaleProject[];
  total: number;
  warning_count: number;   // 7-14 days
  critical_count: number;  // 14+ days
  threshold_days: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const thresholdDays = Math.max(1, parseInt(String(req.query.days || '7'), 10));

  try {
    const sql = neon(process.env.DATABASE_URL!);

    const rows = await sql`
      SELECT
        p.id,
        p.project_name,
        p.project_code,
        p.status,
        p.updated_at,
        c.company_name AS client_name,
        EXTRACT(DAY FROM NOW() - p.updated_at)::int AS days_stale
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      WHERE
        p.status NOT IN ('completed', 'cancelled', 'archived', 'on_hold')
        AND p.updated_at < NOW() - (${thresholdDays} || ' days')::interval
      ORDER BY p.updated_at ASC
      LIMIT 50
    `;

    const projects: StaleProject[] = rows.map(row => ({
      id: String(row.id),
      project_name: String(row.project_name),
      project_code: row.project_code ? String(row.project_code) : null,
      status: String(row.status),
      updated_at: String(row.updated_at),
      client_name: row.client_name ? String(row.client_name) : null,
      days_stale: Number(row.days_stale),
      severity: Number(row.days_stale) >= 14 ? 'critical' : 'warning',
    }));

    const response: StaleProjectsResponse = {
      projects,
      total: projects.length,
      warning_count: projects.filter(p => p.severity === 'warning').length,
      critical_count: projects.filter(p => p.severity === 'critical').length,
      threshold_days: thresholdDays,
    };

    log.info(`Found ${projects.length} stale projects (threshold: ${thresholdDays}d)`, undefined, 'StaleProjects');
    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Failed to fetch stale projects', { error: { error } }, 'StaleProjects');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
