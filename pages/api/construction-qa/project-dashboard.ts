/**
 * Project Dashboard API
 *
 * GET /api/construction-qa/project-dashboard
 *   Returns per-project aggregates: feature counts, QA status breakdown,
 *   photo count, OTDR tests, zone/PON counts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    // QA stats per project per discipline
    const qaRows = await sql`
      SELECT
        r.project_id,
        p.project_name,
        r.discipline,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework_needed,
        SUM(COALESCE(r.photo_count, 0))::int AS photo_count,
        COUNT(DISTINCT r.zone_no)::int AS zone_count,
        COUNT(DISTINCT r.pon_no)::int AS pon_count
      FROM construction_qa_reviews r
      JOIN projects p ON p.id = r.project_id
      GROUP BY r.project_id, p.project_name, r.discipline
      ORDER BY p.project_name
    `;

    // OTDR counts per project
    const otdrRows = await sql`
      SELECT project_id, COUNT(*)::int AS otdr_count
      FROM exfo_test_results
      WHERE project_id IS NOT NULL
      GROUP BY project_id
    `;
    const otdrMap = new Map<string, number>();
    for (const row of otdrRows) {
      otdrMap.set(row.project_id, Number(row.otdr_count));
    }

    // Assemble per-project rows
    const projectMap = new Map<string, {
      project_id: string;
      project_name: string;
      total_features: number;
      photo_count: number;
      zone_count: number;
      pon_count: number;
      otdr_count: number;
      civil: { total: number; pending: number; approved: number; rejected: number; rework_needed: number };
      optical: { total: number; pending: number; approved: number; rejected: number; rework_needed: number };
      splicing: { total: number; pending: number; approved: number; rejected: number; rework_needed: number };
    }>();

    const emptyDiscipline = () => ({ total: 0, pending: 0, approved: 0, rejected: 0, rework_needed: 0 });

    for (const row of qaRows) {
      const pid = row.project_id;
      if (!projectMap.has(pid)) {
        projectMap.set(pid, {
          project_id: pid,
          project_name: row.project_name,
          total_features: 0,
          photo_count: 0,
          zone_count: 0,
          pon_count: 0,
          otdr_count: otdrMap.get(pid) || 0,
          civil: emptyDiscipline(),
          optical: emptyDiscipline(),
          splicing: emptyDiscipline(),
        });
      }
      const proj = projectMap.get(pid)!;
      const disc = row.discipline as 'civil' | 'optical' | 'splicing';
      proj[disc] = {
        total: Number(row.total),
        pending: Number(row.pending),
        approved: Number(row.approved),
        rejected: Number(row.rejected),
        rework_needed: Number(row.rework_needed),
      };
      proj.total_features += Number(row.total);
      proj.photo_count += Number(row.photo_count);
      // Use max zone/pon counts across disciplines (they overlap)
      proj.zone_count = Math.max(proj.zone_count, Number(row.zone_count));
      proj.pon_count = Math.max(proj.pon_count, Number(row.pon_count));
    }

    const projects = Array.from(projectMap.values());

    return apiResponse.success(res, { projects });
  } catch (error) {
    log.error('Project dashboard API error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, { projects: [] });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
