/**
 * Zone Hierarchy API
 *
 * GET /api/construction-qa/zone-hierarchy?projectId=UUID
 *   Returns Zone → PON tree for a project with QA stats and pipeline stage.
 *   Optional: ?discipline=civil to filter by discipline.
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

  const projectId = req.query.projectId as string;
  if (!projectId) {
    return apiResponse.badRequest(res, 'projectId is required');
  }

  const discipline = req.query.discipline as string || '';

  try {
    // QA stats grouped by zone/pon
    const conditions: string[] = ['r.project_id = $1::uuid'];
    const params: (string | number)[] = [projectId];
    let paramIdx = 2;

    if (discipline) {
      conditions.push(`r.discipline = $${paramIdx}`);
      params.push(discipline);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Include ALL features (with and without zone) — NULL zones go into "Unassigned"
    const qaQuery = `
      SELECT
        r.zone_no,
        r.pon_no,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE r.workflow_status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE r.workflow_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE r.workflow_status = 'rejected')::int AS rejected,
        COUNT(*) FILTER (WHERE r.workflow_status = 'rework_needed')::int AS rework_needed,
        SUM(COALESCE(r.photo_count, 0))::int AS photo_count,
        COUNT(*) FILTER (WHERE r.discipline = 'civil')::int AS civil_count,
        COUNT(*) FILTER (WHERE r.discipline = 'optical')::int AS optical_count,
        COUNT(*) FILTER (WHERE r.discipline = 'splicing')::int AS splicing_count
      FROM construction_qa_reviews r
      WHERE ${whereClause}
      GROUP BY r.zone_no, r.pon_no
      ORDER BY r.zone_no NULLS LAST, r.pon_no NULLS LAST
    `;

    // Pipeline stages from pon_stage_tracking
    const stageQuery = `
      SELECT zone_no, pon_no, overall_stage
      FROM pon_stage_tracking
      WHERE project_id = $1::uuid
    `;

    const [qaRows, stageRows] = await Promise.all([
      sql.query(qaQuery, params),
      sql.query(stageQuery, [projectId]),
    ]);

    // Build stage lookup
    const stageMap = new Map<string, string>();
    for (const row of stageRows) {
      stageMap.set(`${row.zone_no}-${row.pon_no}`, row.overall_stage);
    }

    // Assemble zone → pon tree
    const zoneMap = new Map<number, {
      zone_no: number;
      total: number;
      approved: number;
      pending: number;
      rejected: number;
      rework_needed: number;
      pons: {
        pon_no: number;
        total: number;
        approved: number;
        pending: number;
        rejected: number;
        rework_needed: number;
        photo_count: number;
        overall_stage: string | null;
        civil_count: number;
        optical_count: number;
        splicing_count: number;
      }[];
    }>();

    for (const row of qaRows) {
      // Use -1 as sentinel for unassigned features (zone_no IS NULL)
      const zn = row.zone_no != null ? Number(row.zone_no) : -1;
      const pn = row.pon_no != null ? Number(row.pon_no) : null;

      if (!zoneMap.has(zn)) {
        zoneMap.set(zn, {
          zone_no: zn,
          total: 0,
          approved: 0,
          pending: 0,
          rejected: 0,
          rework_needed: 0,
          pons: [],
        });
      }

      const zone = zoneMap.get(zn)!;
      const total = Number(row.total);
      const approved = Number(row.approved);
      const pending = Number(row.pending);
      const rejected = Number(row.rejected);
      const reworkNeeded = Number(row.rework_needed);

      zone.total += total;
      zone.approved += approved;
      zone.pending += pending;
      zone.rejected += rejected;
      zone.rework_needed += reworkNeeded;

      if (pn !== null) {
        zone.pons.push({
          pon_no: pn,
          total,
          approved,
          pending,
          rejected,
          rework_needed: reworkNeeded,
          photo_count: Number(row.photo_count),
          overall_stage: stageMap.get(`${zn}-${pn}`) || null,
          civil_count: Number(row.civil_count),
          optical_count: Number(row.optical_count),
          splicing_count: Number(row.splicing_count),
        });
      }
    }

    const zones = Array.from(zoneMap.values()).sort((a, b) => a.zone_no - b.zone_no);

    return apiResponse.success(res, { zones });
  } catch (error) {
    log.error('Zone hierarchy API error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, { zones: [] });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
