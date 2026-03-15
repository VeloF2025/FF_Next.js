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
    const [qaRows, otdrRows, poleRows, unmatchedPlantedRows, infraRows, qaByFeatureRows, polesWithPhotosRows, completenessRows, reviewAttributionRows] = await Promise.all([
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
      // Photo step completeness per project
      sql`
        SELECT
          r.project_id,
          COUNT(*)::int AS total_reviews,
          COUNT(*) FILTER (WHERE sc.steps_with_photos >= 7)::int AS complete_7,
          COUNT(*) FILTER (WHERE sc.steps_with_photos BETWEEN 4 AND 6)::int AS steps_4_to_6,
          COUNT(*) FILTER (WHERE sc.steps_with_photos BETWEEN 1 AND 3)::int AS steps_1_to_3,
          COUNT(*) FILTER (WHERE COALESCE(sc.steps_with_photos, 0) = 0)::int AS no_photos,
          COUNT(*) FILTER (WHERE NOT sc.has_step_1)::int AS missing_step_1,
          COUNT(*) FILTER (WHERE NOT sc.has_step_2)::int AS missing_step_2,
          COUNT(*) FILTER (WHERE NOT sc.has_step_3)::int AS missing_step_3,
          COUNT(*) FILTER (WHERE NOT sc.has_step_4)::int AS missing_step_4,
          COUNT(*) FILTER (WHERE NOT sc.has_step_5)::int AS missing_step_5,
          COUNT(*) FILTER (WHERE NOT sc.has_step_6)::int AS missing_step_6,
          COUNT(*) FILTER (WHERE NOT sc.has_step_7)::int AS missing_step_7
        FROM construction_qa_reviews r
        LEFT JOIN (
          SELECT
            review_id,
            COUNT(DISTINCT checklist_step) FILTER (WHERE checklist_step BETWEEN 1 AND 7)::int AS steps_with_photos,
            BOOL_OR(checklist_step = 1) AS has_step_1,
            BOOL_OR(checklist_step = 2) AS has_step_2,
            BOOL_OR(checklist_step = 3) AS has_step_3,
            BOOL_OR(checklist_step = 4) AS has_step_4,
            BOOL_OR(checklist_step = 5) AS has_step_5,
            BOOL_OR(checklist_step = 6) AS has_step_6,
            BOOL_OR(checklist_step = 7) AS has_step_7
          FROM construction_qa_photos
          GROUP BY review_id
        ) sc ON sc.review_id = r.id
        GROUP BY r.project_id
      `,
      // AI vs human approval attribution per project
      sql`
        SELECT
          project_id,
          COUNT(*) FILTER (
            WHERE qa_decision = 'PASS' AND qa_decision_by = 'VLM Auto-Approve'
          )::int AS ai_approved,
          COUNT(*) FILTER (
            WHERE qa_decision = 'PASS'
              AND qa_decision_by IS NOT NULL
              AND qa_decision_by != 'VLM Auto-Approve'
          )::int AS human_approved
        FROM construction_qa_reviews
        GROUP BY project_id
      `,
    ]);

    const otdrMap = new Map<string, number>();
    for (const row of otdrRows) {
      otdrMap.set(row.project_id, Number(row.otdr_count));
    }

    // Build AI vs human approval attribution map
    const attributionMap = new Map<string, { ai_approved: number; human_approved: number }>();
    for (const row of reviewAttributionRows) {
      attributionMap.set(row.project_id, {
        ai_approved: Number(row.ai_approved),
        human_approved: Number(row.human_approved),
      });
    }

    // Build photo completeness map
    const stepLabels: Record<number, string> = {
      1: 'Before', 2: 'During', 3: 'Depth', 4: 'End Plates', 5: 'Compaction', 6: 'Level', 7: 'After',
    };
    const completenessMap = new Map<string, {
      complete_7: number; steps_4_to_6: number; steps_1_to_3: number;
      no_photos: number; total_reviews: number; completeness_pct: number;
      most_missing_step: string | null;
    }>();
    for (const row of completenessRows) {
      const total = Number(row.total_reviews);
      const complete7 = Number(row.complete_7);
      let maxMissing = 0;
      let maxStep = 0;
      for (let s = 1; s <= 7; s++) {
        const missing = Number(row[`missing_step_${s}`]);
        if (missing > maxMissing) { maxMissing = missing; maxStep = s; }
      }
      completenessMap.set(row.project_id, {
        complete_7: complete7,
        steps_4_to_6: Number(row.steps_4_to_6),
        steps_1_to_3: Number(row.steps_1_to_3),
        no_photos: Number(row.no_photos),
        total_reviews: total,
        completeness_pct: total > 0 ? Math.round((complete7 / total) * 100) : 0,
        most_missing_step: maxStep > 0 && total > 0
          ? `${stepLabels[maxStep]} (${Math.round((maxMissing / total) * 100)}%)`
          : null,
      });
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
      ai_approved: number;
      human_approved: number;
      civil: { total: number; pending: number; approved: number; rejected: number; rework_needed: number };
      optical: { total: number; pending: number; approved: number; rejected: number; rework_needed: number };
      infrastructure: typeof emptyInfrastructure extends () => infer R ? R : never;
      photo_completeness?: {
        complete_7: number; steps_4_to_6: number; steps_1_to_3: number;
        no_photos: number; total_reviews: number; completeness_pct: number;
        most_missing_step: string | null;
      };
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
          ai_approved: attributionMap.get(pid)?.ai_approved ?? 0,
          human_approved: attributionMap.get(pid)?.human_approved ?? 0,
          civil: emptyDiscipline(),
          optical: emptyDiscipline(),
          infrastructure: infraMap.get(pid) || emptyInfrastructure(),
          photo_completeness: completenessMap.get(pid) || undefined,
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
