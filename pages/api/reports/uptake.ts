/**
 * API Route: /api/reports/uptake?projectId=<uuid>
 *
 * Returns PON-level uptake data for the Uptake Report.
 * Shared fetcher also used by /api/reports/uptake-pdf.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';

export interface UptakePon {
  pon: string;
  drops: number;
  active: number;
}

export interface UptakeReportPayload {
  projectId: string;
  projectName: string;
  targetPct: number;
  pons: UptakePon[];
}

const DEFAULT_TARGET_PCT = 65;

interface PonDbRow {
  pon_no: string | null;
  total: string;
  active: string;
}

interface ProjectDbRow {
  id: string;
  project_name: string;
}

export async function fetchUptakePayload(projectId: string): Promise<UptakeReportPayload | null> {
  const client = await pool.connect();
  try {
    const projRes = await client.query<ProjectDbRow>(
      `SELECT id::text AS id, project_name FROM projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );
    const project = projRes.rows[0];
    if (!project) return null;

    const ponRes = await client.query<PonDbRow>(
      `
      SELECT
        d.pon_no::text AS pon_no,
        COUNT(DISTINCT d.drop_number)::text AS total,
        COUNT(DISTINCT CASE WHEN oes.activation_date IS NOT NULL THEN d.drop_number END)::text AS active
      FROM drops d
      LEFT JOIN oes_activations oes ON oes.drop_number = d.drop_number
      WHERE d.project_id = $1
        AND d.pon_no IS NOT NULL
      GROUP BY d.pon_no
      ORDER BY d.pon_no
      `,
      [projectId]
    );

    const pons: UptakePon[] = ponRes.rows.map((r: PonDbRow) => ({
      pon: `PON-${r.pon_no}`,
      drops: Number(r.total),
      active: Number(r.active),
    }));

    return {
      projectId: project.id,
      projectName: project.project_name,
      targetPct: DEFAULT_TARGET_PCT,
      pons,
    };
  } finally {
    client.release();
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const { projectId } = req.query;
  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'projectId query parameter is required');
  }

  try {
    const payload = await fetchUptakePayload(projectId);
    if (!payload) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    log.info('Fetched uptake payload', {
      projectId,
      pons: payload.pons.length,
    }, 'UptakeReportAPI');
    return apiResponse.success(res, payload);
  } catch (error) {
    log.error('Failed to fetch uptake payload', { error, projectId }, 'UptakeReportAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('analytics.read')(handler));
