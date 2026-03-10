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
import { withAuth, withPermission } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const [qaRows, otdrRows, poleRows, unmatchedPlantedRows, infraRows, qaByFeatureRows, polesWithPhotosRows] = await Promise.all([
      // QA stats per project per discipline
      sql`
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
      `,
      // OTDR counts per project
      sql`
        SELECT project_id, COUNT(*)::int AS otdr_count
        FROM exfo_test_results
        WHERE project_id IS NOT NULL
        GROUP BY project_id
      `,
      // Infrastructure inventory counts — planted = field status OR has QA photos
      sql`
        SELECT project_id, 'poles' AS infra_type, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE pole_planted IN ('Pole Planted', 'Yes', 'Planted')
                 OR pole_number IN (
                   SELECT feature_id FROM construction_qa_reviews r
                   WHERE r.project_id = poles.project_id AND r.feature_type = 'pole' AND r.photo_count > 0
                 )
               )::int AS field_done
        FROM poles WHERE project_id IS NOT NULL GROUP BY project_id
      `,
      // Poles with QA photos but unmatched to poles table (QField internal IDs)
      sql`
        SELECT r.project_id, COUNT(*)::int AS unmatched_planted
        FROM construction_qa_reviews r
        WHERE r.feature_type = 'pole' AND r.photo_count > 0
          AND NOT EXISTS (
            SELECT 1 FROM poles pol
            WHERE pol.project_id = r.project_id AND pol.pole_number = r.feature_id
          )
        GROUP BY r.project_id
      `,
      // Joints + cable_spans inventory
      sql`
        SELECT project_id, 'joints' AS infra_type, COUNT(*)::int AS total, 0 AS field_done
        FROM joints WHERE project_id IS NOT NULL GROUP BY project_id
        UNION ALL
        SELECT project_id, 'cable_spans', COUNT(*)::int, 0
        FROM cable_spans WHERE project_id IS NOT NULL GROUP BY project_id
      `,
      // QA counts by feature_type
      sql`
        SELECT project_id, feature_type, COUNT(*)::int AS qa_total,
               COUNT(*) FILTER (WHERE workflow_status = 'approved')::int AS qa_approved
        FROM construction_qa_reviews
        GROUP BY project_id, feature_type
      `,
      // Poles with assigned photos (distinct pole numbers that have QA photos)
      sql`
        SELECT project_id, COUNT(DISTINCT feature_id)::int AS assigned_count
        FROM construction_qa_reviews
        WHERE feature_type = 'pole' AND photo_count > 0
        GROUP BY project_id
      `,
    ]);

    const otdrMap = new Map<string, number>();
    for (const row of otdrRows) {
      otdrMap.set(row.project_id, Number(row.otdr_count));
    }

    // Build infrastructure map: project_id → { poles, joints, cable_spans }
    const emptyInfra = () => ({ total: 0, planted: 0, assigned: 0, qa_total: 0, qa_approved: 0 });
    const emptyInfrastructure = () => ({
      poles: emptyInfra(),
      joints: emptyInfra(),
      cable_spans: emptyInfra(),
    });

    type InfraEntry = { total: number; planted: number; assigned: number; qa_total: number; qa_approved: number };
    const infraMap = new Map<string, {
      poles: InfraEntry;
      joints: InfraEntry;
      cable_spans: InfraEntry;
    }>();

    // Poles from dedicated query (includes matched photo-based planted)
    for (const row of poleRows) {
      const pid = row.project_id;
      if (!infraMap.has(pid)) infraMap.set(pid, emptyInfrastructure());
      const infra = infraMap.get(pid)!;
      infra.poles.total = Number(row.total);
      infra.poles.planted = Number(row.field_done);
    }

    // Add unmatched planted (QField reviews with photos but no pole record match)
    for (const row of unmatchedPlantedRows) {
      const pid = row.project_id;
      if (!infraMap.has(pid)) infraMap.set(pid, emptyInfrastructure());
      infraMap.get(pid)!.poles.planted += Number(row.unmatched_planted);
    }

    // Poles with assigned photos
    for (const row of polesWithPhotosRows) {
      const pid = row.project_id;
      if (!infraMap.has(pid)) infraMap.set(pid, emptyInfrastructure());
      infraMap.get(pid)!.poles.assigned = Number(row.assigned_count);
    }

    // Joints + cable_spans
    for (const row of infraRows) {
      const pid = row.project_id;
      if (!infraMap.has(pid)) infraMap.set(pid, emptyInfrastructure());
      const infra = infraMap.get(pid)!;
      const itype = row.infra_type as 'joints' | 'cable_spans';
      infra[itype].total = Number(row.total);
    }

    // Merge QA counts by feature_type into infra map
    const featureTypeToInfra: Record<string, 'poles' | 'joints' | 'cable_spans'> = {
      pole: 'poles',
      joint: 'joints',
      cable_span: 'cable_spans',
    };
    for (const row of qaByFeatureRows) {
      const itype = featureTypeToInfra[row.feature_type];
      if (!itype) continue;
      const pid = row.project_id;
      if (!infraMap.has(pid)) infraMap.set(pid, emptyInfrastructure());
      const infra = infraMap.get(pid)!;
      infra[itype].qa_total = Number(row.qa_total);
      infra[itype].qa_approved = Number(row.qa_approved);
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
      infrastructure: typeof emptyInfrastructure extends () => infer R ? R : never;
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
          infrastructure: infraMap.get(pid) || emptyInfrastructure(),
        });
      }
      const proj = projectMap.get(pid)!;
      const disc = row.discipline as 'civil' | 'optical';
      if (disc !== 'civil' && disc !== 'optical') continue; // guard against legacy data
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

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
