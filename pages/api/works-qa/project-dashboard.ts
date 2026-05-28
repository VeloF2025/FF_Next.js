import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import type {
  WorksQADashboardRow,
  WorksQADashboardResponse,
} from '@/modules/works-qa/types/dashboard.types';

// Inverse of CLAUDE.md "files <300 lines": this one big aggregation deliberately
// builds the whole dashboard in a single round-trip. Per-row sub-queries (open
// snags, most-missing slot) are evaluated inside the same CTE pipeline so the
// 60s cache header keeps p95 down even on the 2000+ pole projects.

const CIVIL_SLOTS = ['civil_step_01_key','civil_step_02_key','civil_step_03_key','civil_step_04_key','civil_step_05_key','civil_step_06_key','civil_step_07_key','civil_step_08_key'] as const;
const DOME_SLOTS  = ['optical_dome_01_key','optical_dome_02_key','optical_dome_03_key','optical_dome_04_key','optical_dome_05_key','optical_dome_06_key','optical_dome_07_key','optical_dome_08_key'] as const;
const JOINT_SLOTS = ['main_joint_11_key','main_joint_12_key','main_joint_13_key','main_joint_14_key','main_joint_15_key','main_joint_16_key'] as const;

// Build a `(COL_NOT_NULL_TO_INT) + ...` expression. Used both for civil/dome/joint
// fill counts and for the overall all-slot completeness count.
function sumNotNull(cols: readonly string[]): string {
  return cols.map(c => `(qa.${c} IS NOT NULL)::int`).join(' + ');
}

// Total fixed photo slots (excludes tray + unassigned). Derived from the slot
// arrays so the "complete" / "partial_high" boundaries below track SLOT_META —
// adding a slot (e.g. civil step 8) shifts these automatically.
const TOTAL_SLOT_COUNT = CIVIL_SLOTS.length + DOME_SLOTS.length + JOINT_SLOTS.length;
const TOTAL_SLOTS_EXPR = sumNotNull([...CIVIL_SLOTS, ...DOME_SLOTS, ...JOINT_SLOTS]);
const CIVIL_SLOTS_EXPR = sumNotNull(CIVIL_SLOTS);
const DOME_SLOTS_EXPR  = sumNotNull(DOME_SLOTS);
const JOINT_SLOTS_EXPR = sumNotNull(JOINT_SLOTS);

// Per-slot UNNEST so we can compute "most missing slot" — the slot key that is
// empty (NULL) on the most poles. Returned as a single text + count.
const ALL_SLOT_COLS: readonly string[] = [...CIVIL_SLOTS, ...DOME_SLOTS, ...JOINT_SLOTS];

interface DashboardRawRow {
  project_id: string;
  project_name: string;
  project_code: string | null;
  total_poles: number;
  fully_approved: number;
  in_progress: number;
  empty: number;
  civil_approved: number;
  civil_in_progress: number;
  civil_empty: number;
  civil_vlm_failed: number;
  dome_approved: number;
  dome_in_progress: number;
  dome_empty: number;
  dome_vlm_failed: number;
  joint_approved: number;
  joint_in_progress: number;
  joint_empty: number;
  joint_vlm_failed: number;
  complete_full: number;
  partial_high: number;
  partial_mid: number;
  partial_low: number;
  no_photos: number;
  most_missing_slot: string | null;
  most_missing_count: number;
  unassigned_total: number;
  unassigned_poles: number;
  override_count: number;
  open_snags: number;
  zone_count: number;
  pon_count: number;
  photo_count: number;
  last_synced_at: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  try {
    // Build per-slot missing counts via UNNEST. The slot column names are
    // hardcoded from ALL_SLOT_COLS so there's no injection vector.
    const slotMissingUnion = ALL_SLOT_COLS
      .map(c => `SELECT qa.project_id, '${c}' AS slot, (qa.${c} IS NULL)::int AS missing FROM pole_qa_photos qa`)
      .join(' UNION ALL ');

    const sql = `
      WITH pole_universe AS (
        SELECT DISTINCT l.fibreflow_project_id AS project_id, q.feature_id AS pole_label
        FROM qfield_photo_validations q
        INNER JOIN qfield_project_links l ON l.qfield_project_id = q.project_id
        WHERE q.feature_type = 'pole'
        UNION
        SELECT DISTINCT project_id, pole_label FROM pole_qa_photos
      ),
      pole_metrics AS (
        SELECT
          u.project_id,
          u.pole_label,
          (qa.civil_approved AND qa.dome_approved AND qa.joint_approved)              AS fully_approved,
          (qa.civil_approved OR qa.dome_approved OR qa.joint_approved)                AS any_approved,
          COALESCE(qa.civil_approved, FALSE)  AS civil_approved,
          COALESCE(qa.dome_approved, FALSE)   AS dome_approved,
          COALESCE(qa.joint_approved, FALSE)  AS joint_approved,
          COALESCE((${CIVIL_SLOTS_EXPR}), 0)  AS civil_filled,
          COALESCE((${DOME_SLOTS_EXPR}), 0)   AS dome_filled,
          COALESCE((${JOINT_SLOTS_EXPR}), 0)  AS joint_filled,
          COALESCE((${TOTAL_SLOTS_EXPR}), 0)  AS total_filled,
          COALESCE(array_length(qa.unassigned_photo_keys, 1), 0) AS unassigned_n,
          COALESCE(array_length(qa.main_joint_tray_keys,  1), 0) AS tray_n,
          (qa.overridden_at IS NOT NULL)::int AS is_override,
          qa.updated_at,
          COALESCE((
            SELECT COUNT(*)::int FROM jsonb_each(COALESCE(qa.vlm_results, '{}'::jsonb)) je
            WHERE (je.value->>'valid')::boolean = false
              AND je.value->>'overridden_by' IS NULL
              AND je.key LIKE 'civil_%'
          ), 0) AS civil_vlm_failed,
          COALESCE((
            SELECT COUNT(*)::int FROM jsonb_each(COALESCE(qa.vlm_results, '{}'::jsonb)) je
            WHERE (je.value->>'valid')::boolean = false
              AND je.value->>'overridden_by' IS NULL
              AND je.key LIKE 'dome_%'
          ), 0) AS dome_vlm_failed,
          COALESCE((
            SELECT COUNT(*)::int FROM jsonb_each(COALESCE(qa.vlm_results, '{}'::jsonb)) je
            WHERE (je.value->>'valid')::boolean = false
              AND je.value->>'overridden_by' IS NULL
              AND je.key LIKE 'main_joint_%'
          ), 0) AS joint_vlm_failed
        FROM pole_universe u
        LEFT JOIN pole_qa_photos qa
          ON qa.project_id = u.project_id AND qa.pole_label = u.pole_label
      ),
      slot_missing AS (
        SELECT project_id, slot, SUM(missing)::int AS missing_count
        FROM (${slotMissingUnion}) s
        GROUP BY project_id, slot
      ),
      most_missing AS (
        SELECT DISTINCT ON (project_id) project_id, slot AS most_missing_slot, missing_count AS most_missing_count
        FROM slot_missing
        WHERE missing_count > 0
        ORDER BY project_id, missing_count DESC, slot ASC
      ),
      open_snags AS (
        -- Works-QA snags live in the shared snags table with source='works_qa'
        -- and link to a pole via snags.pole_qa_photo_id. "Open" = anything not
        -- yet verified/resolved.
        SELECT pqp.project_id, COUNT(*)::int AS open_count
        FROM snags s
        INNER JOIN pole_qa_photos pqp ON pqp.id = s.pole_qa_photo_id
        WHERE s.source = 'works_qa'
          AND COALESCE(s.status, 'open') NOT IN ('verified', 'resolved', 'closed')
        GROUP BY pqp.project_id
      ),
      project_zone_pon AS (
        SELECT project_id,
               COUNT(DISTINCT zone_no) FILTER (WHERE zone_no IS NOT NULL)::int AS zone_count,
               COUNT(DISTINCT pon_no)  FILTER (WHERE pon_no  IS NOT NULL)::int AS pon_count
        FROM pole_qa_photos
        GROUP BY project_id
      )
      SELECT
        p.id            AS project_id,
        p.project_name  AS project_name,
        p.project_code  AS project_code,

        COUNT(m.pole_label)::int                                              AS total_poles,
        COUNT(*) FILTER (WHERE m.fully_approved)::int                         AS fully_approved,
        COUNT(*) FILTER (WHERE m.any_approved AND NOT m.fully_approved)::int  AS in_progress,
        -- "empty" = no photos anywhere: no slot, no tray, no unassigned bucket.
        -- Otherwise a pole with only tray-uploads would be reported as untouched.
        COUNT(*) FILTER (WHERE
          COALESCE(m.total_filled, 0) = 0
          AND COALESCE(m.tray_n, 0)      = 0
          AND COALESCE(m.unassigned_n,0) = 0
        )::int AS empty,

        COUNT(*) FILTER (WHERE m.civil_approved)::int                                              AS civil_approved,
        COUNT(*) FILTER (WHERE COALESCE(m.civil_filled,0) > 0 AND NOT m.civil_approved)::int       AS civil_in_progress,
        COUNT(*) FILTER (WHERE COALESCE(m.civil_filled,0) = 0)::int                                AS civil_empty,
        COALESCE(SUM(m.civil_vlm_failed), 0)::int                                                  AS civil_vlm_failed,

        COUNT(*) FILTER (WHERE m.dome_approved)::int                                               AS dome_approved,
        COUNT(*) FILTER (WHERE COALESCE(m.dome_filled,0) > 0 AND NOT m.dome_approved)::int         AS dome_in_progress,
        COUNT(*) FILTER (WHERE COALESCE(m.dome_filled,0) = 0)::int                                 AS dome_empty,
        COALESCE(SUM(m.dome_vlm_failed), 0)::int                                                   AS dome_vlm_failed,

        COUNT(*) FILTER (WHERE m.joint_approved)::int                                              AS joint_approved,
        COUNT(*) FILTER (WHERE COALESCE(m.joint_filled,0) > 0 AND NOT m.joint_approved)::int       AS joint_in_progress,
        COUNT(*) FILTER (WHERE COALESCE(m.joint_filled,0) = 0)::int                                AS joint_empty,
        COALESCE(SUM(m.joint_vlm_failed), 0)::int                                                  AS joint_vlm_failed,

        COUNT(*) FILTER (WHERE m.total_filled = ${TOTAL_SLOT_COUNT})::int                          AS complete_full,
        COUNT(*) FILTER (WHERE m.total_filled BETWEEN 14 AND ${TOTAL_SLOT_COUNT - 1})::int         AS partial_high,
        COUNT(*) FILTER (WHERE m.total_filled BETWEEN 7  AND 13)::int                              AS partial_mid,
        COUNT(*) FILTER (WHERE m.total_filled BETWEEN 1  AND 6 )::int                              AS partial_low,
        -- "no_photos" band only counts poles with zero photos in any bucket
        -- (slots, tray, unassigned) — tray-only or unassigned-only poles
        -- still have *some* progress to surface.
        COUNT(*) FILTER (WHERE
          COALESCE(m.total_filled,0) = 0
          AND COALESCE(m.tray_n,0)      = 0
          AND COALESCE(m.unassigned_n,0) = 0
        )::int AS no_photos,

        mm.most_missing_slot                                                                       AS most_missing_slot,
        COALESCE(mm.most_missing_count, 0)::int                                                    AS most_missing_count,

        COALESCE(SUM(m.unassigned_n), 0)::int                                                      AS unassigned_total,
        COUNT(*) FILTER (WHERE COALESCE(m.unassigned_n, 0) > 0)::int                               AS unassigned_poles,
        COALESCE(SUM(m.is_override), 0)::int                                                       AS override_count,

        COALESCE(os.open_count, 0)::int                                                            AS open_snags,
        COALESCE(zp.zone_count, 0)::int                                                            AS zone_count,
        COALESCE(zp.pon_count, 0)::int                                                             AS pon_count,
        COALESCE(SUM(m.total_filled + m.tray_n + m.unassigned_n), 0)::int                          AS photo_count,
        MAX(m.updated_at)::text                                                                    AS last_synced_at

      FROM projects p
      LEFT JOIN pole_metrics m  ON m.project_id  = p.id
      LEFT JOIN most_missing mm ON mm.project_id = p.id
      LEFT JOIN open_snags  os  ON os.project_id = p.id
      LEFT JOIN project_zone_pon zp ON zp.project_id = p.id
      WHERE p.status != 'archived'
      GROUP BY p.id, p.project_name, p.project_code,
               mm.most_missing_slot, mm.most_missing_count, os.open_count,
               zp.zone_count, zp.pon_count
      HAVING COUNT(m.pole_label) > 0
      ORDER BY p.project_name ASC
    `;

    const result = await pool.query<DashboardRawRow>(sql);

    const projects: WorksQADashboardRow[] = result.rows.map(r => ({
      project_id: r.project_id,
      project_name: r.project_name,
      project_code: r.project_code,
      total_poles: r.total_poles,
      fully_approved: r.fully_approved,
      qa_progress_pct: r.total_poles > 0 ? Math.round((r.fully_approved / r.total_poles) * 100) : 0,
      in_progress: r.in_progress,
      empty: r.empty,
      civil: {
        capacity: CIVIL_SLOTS.length,
        approved: r.civil_approved,
        in_progress: r.civil_in_progress,
        empty: r.civil_empty,
        vlm_failed: r.civil_vlm_failed,
      },
      dome: {
        capacity: DOME_SLOTS.length,
        approved: r.dome_approved,
        in_progress: r.dome_in_progress,
        empty: r.dome_empty,
        vlm_failed: r.dome_vlm_failed,
      },
      main_joint: {
        capacity: JOINT_SLOTS.length,
        approved: r.joint_approved,
        in_progress: r.joint_in_progress,
        empty: r.joint_empty,
        vlm_failed: r.joint_vlm_failed,
      },
      photo_completeness: {
        complete_full: r.complete_full,
        partial_high: r.partial_high,
        partial_mid:  r.partial_mid,
        partial_low:  r.partial_low,
        no_photos:    r.no_photos,
        most_missing_slot:  r.most_missing_slot,
        most_missing_count: r.most_missing_count,
      },
      unassigned_total: r.unassigned_total,
      unassigned_poles: r.unassigned_poles,
      override_count: r.override_count,
      open_snags: r.open_snags,
      zone_count: r.zone_count,
      pon_count: r.pon_count,
      photo_count: r.photo_count,
      last_synced_at: r.last_synced_at,
    }));

    const body: WorksQADashboardResponse = { projects };
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return apiResponse.success(res, body);
  } catch (err) {
    log.error('works-qa/project-dashboard', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
