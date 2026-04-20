/**
 * API Route: /api/reports/uptake?projectId=<uuid> OR ?project=<name>
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

export interface UptakeLookup {
  projectId?: string;
  projectName?: string;
}

async function resolveProject(lookup: UptakeLookup): Promise<ProjectDbRow | null> {
  const client = await pool.connect();
  try {
    if (lookup.projectId) {
      const res = await client.query<ProjectDbRow>(
        `SELECT id::text AS id, project_name FROM projects WHERE id = $1 LIMIT 1`,
        [lookup.projectId]
      );
      return res.rows[0] ?? null;
    }
    if (lookup.projectName) {
      const res = await client.query<ProjectDbRow>(
        `SELECT id::text AS id, project_name FROM projects WHERE project_name = $1 LIMIT 1`,
        [lookup.projectName]
      );
      return res.rows[0] ?? null;
    }
    return null;
  } finally {
    client.release();
  }
}

export async function fetchUptakePayload(
  lookup: UptakeLookup
): Promise<UptakeReportPayload | null> {
  const project = await resolveProject(lookup);
  if (!project) return null;

  const client = await pool.connect();
  try {
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
      [project.id]
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

  const { projectId, project } = req.query;
  const lookup: UptakeLookup = {};
  if (typeof projectId === 'string' && projectId) lookup.projectId = projectId;
  if (typeof project === 'string' && project) lookup.projectName = project;

  if (!lookup.projectId && !lookup.projectName) {
    return apiResponse.badRequest(res, 'projectId or project query parameter is required');
  }

  try {
    const payload = await fetchUptakePayload(lookup);
    if (!payload) {
      return apiResponse.notFound(res, 'Project', lookup.projectId ?? lookup.projectName ?? '');
    }

    log.info(
      'Fetched uptake payload',
      { lookup, pons: payload.pons.length },
      'UptakeReportAPI'
    );
    return apiResponse.success(res, payload);
  } catch (error) {
    log.error('Failed to fetch uptake payload', { error, lookup }, 'UptakeReportAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('analytics.read')(handler));
