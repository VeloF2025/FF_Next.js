/**
 * One project, one screen: what is on site, how fast it is moving, and what is unresolved.
 *
 * Built as ONE query with independent CTEs rather than a chain of joins. The volumes make
 * that non-negotiable: `drops` holds 180k rows and `pole_qa_photos` 15k, and joining them
 * directly produced a cartesian blowup that ran for two minutes before being killed.
 * Each CTE aggregates its own store, and the outer SELECT reads one row from each.
 *
 * Every count here is an ACTUAL. Nothing in this file compares against a plan, because
 * FibreFlow holds no maintained schedule — see coverage.ts.
 */
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';

import { measure, ratio, throughput, type Measure, type Ratio, type Throughput } from './coverage';

/**
 * Works-QA stores photos as up to 22 named key columns per pole, so "how many photos"
 * is a sum across columns, not a row count. Summing the non-null keys is cheaper than
 * unpivoting when only the total is wanted. SLOT_META is a trusted in-code constant.
 */
const SLOT_PHOTO_COUNT = SLOT_META.map((s) => `(${s.dbColumn} IS NOT NULL)::int`).join(' + ');

export interface OverviewRow {
  project_id: string;
  project_name: string;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  sow_drops: string;
  poles: string;
  poles_after_photo: string;
  poles_approved: string;
  poles_last_7d: string;
  poles_prior_7d: string;
  works_qa_photos: string;
  newest_pole_at: string | null;
  qa_photos: string;
  qfield_photos: string;
  vlm_pass: string;
  vlm_fail: string;
  vlm_unscored: string;
  activations: string;
  activations_last_7d: string;
  open_snags: string;
  purchase_orders: string;
}

/**
 * Resolve by UUID or by name. Name matching is loose because people say "Etwatwa" while
 * the row says "Etwatwa" and QField calls it "FT_Etwatwa_POP_2"; LIKE wildcards in the
 * input are escaped so `%` cannot silently match every project.
 */
function projectPredicate(project: string, params: unknown[]): string {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project);
  if (isUuid) {
    params.push(project);
    return `p.id = $${params.length}::uuid`;
  }
  params.push(`%${project.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return `p.project_name ILIKE $${params.length}`;
}

export function overviewQuery(project: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const predicate = projectPredicate(project, params);

  return {
    params,
    sql: `
      WITH target AS (
        SELECT p.id, p.project_name, p.status, p.start_date, p.end_date
        FROM projects p WHERE ${predicate}
        ORDER BY p.project_name LIMIT 1
      ),
      sow AS (
        SELECT count(*)::bigint n FROM drops d WHERE d.project_id = (SELECT id FROM target)
      ),
      wq AS (
        SELECT count(*)::bigint                                                        AS n,
               count(*) FILTER (WHERE civil_step_07_key IS NOT NULL)::bigint           AS after_photo,
               count(*) FILTER (WHERE approved_at IS NOT NULL)::bigint                 AS approved,
               count(*) FILTER (WHERE created_at >= now() - interval '7 days')::bigint AS last_7d,
               count(*) FILTER (WHERE created_at >= now() - interval '14 days'
                                  AND created_at <  now() - interval '7 days')::bigint AS prior_7d,
               COALESCE(sum(${SLOT_PHOTO_COUNT}), 0)::bigint                            AS slot_photos,
               max(created_at)                                                         AS newest
        FROM pole_qa_photos WHERE project_id = (SELECT id FROM target)
      ),
      -- Verdicts are counted per SLOT, not per pole: one pole carries up to 22 photos and
      -- can pass some while failing others, so a pole-level count would hide the failures.
      verdicts AS (
        SELECT
          count(*) FILTER (WHERE jsonb_typeof(v.value -> 'valid') = 'boolean'
                             AND (v.value ->> 'valid')::boolean)::bigint       AS pass,
          count(*) FILTER (WHERE jsonb_typeof(v.value -> 'valid') = 'boolean'
                             AND NOT (v.value ->> 'valid')::boolean)::bigint   AS fail,
          count(*) FILTER (WHERE jsonb_typeof(v.value -> 'valid') <> 'boolean')::bigint AS unscored
        FROM pole_qa_photos w
        CROSS JOIN LATERAL jsonb_each(COALESCE(w.vlm_results, '{}'::jsonb)) AS v(key, value)
        WHERE w.project_id = (SELECT id FROM target)
      ),
      cqa AS (
        SELECT count(*)::bigint n FROM construction_qa_photos WHERE project_id = (SELECT id FROM target)
      ),
      -- QField carries no project_id on any of its 60k rows; the project is recoverable
      -- only from the key path via qfield_projects -> qfield_project_links.
      qf AS (
        SELECT count(*)::bigint n
        FROM qfield_photo_validations q
        JOIN qfield_projects qp ON qp.qfield_project_id = split_part(q.photo_key, '/', 2)
        JOIN qfield_project_links l ON l.qfield_project_id = qp.id
        WHERE l.fibreflow_project_id = (SELECT id FROM target)
      ),
      -- Activations hold no project_id either; they reach one through their drop.
      act AS (
        SELECT count(*)::bigint n,
               count(*) FILTER (WHERE a.activation_date >= now() - interval '7 days')::bigint AS last_7d
        FROM oes_activations a
        JOIN drops d ON d.id = a.drop_id
        WHERE d.project_id = (SELECT id FROM target)
      ),
      sn AS (
        SELECT count(*)::bigint n FROM snags
        WHERE project_id = (SELECT id FROM target) AND status NOT IN ('verified', 'closed')
      ),
      po AS (
        SELECT count(*)::bigint n FROM purchase_orders WHERE project_id = (SELECT id FROM target)
      )
      SELECT t.id::text AS project_id, t.project_name, t.status,
             t.start_date::text, t.end_date::text,
             sow.n AS sow_drops,
             wq.n AS poles, wq.after_photo AS poles_after_photo, wq.approved AS poles_approved,
             wq.last_7d AS poles_last_7d, wq.prior_7d AS poles_prior_7d,
             wq.slot_photos AS works_qa_photos,
             wq.newest AS newest_pole_at,
             cqa.n AS qa_photos, qf.n AS qfield_photos,
             verdicts.pass AS vlm_pass, verdicts.fail AS vlm_fail, verdicts.unscored AS vlm_unscored,
             act.n AS activations, act.last_7d AS activations_last_7d,
             sn.n AS open_snags, po.n AS purchase_orders
      FROM target t, sow, wq, verdicts, cqa, qf, act, sn, po`,
  };
}

export interface ProjectOverview {
  project: { id: string; name: string; status: string | null; startDate: string | null; endDate: string | null };
  scope: { sowDrops: Measure; note?: string };
  build: { poles: Measure; withAfterPhoto: Measure; approved: Measure; completion: Ratio; throughput: Throughput; newestPoleAt: string | null };
  quality: { slotsPassed: Measure; slotsFailed: Measure; slotsUnscored: Measure; passRate: Ratio };
  activations: { total: Measure; last7Days: Measure; completion: Ratio };
  photos: { worksQa: Measure; constructionQa: Measure; qfield: Measure; total: number };
  outstanding: { openSnags: Measure; purchaseOrders: Measure };
  caveats: string[];
}

const n = (v: string | null | undefined): number => Number(v ?? 0);

export function shapeOverview(row: OverviewRow): ProjectOverview {
  const sow = n(row.sow_drops);
  const poles = n(row.poles);
  const activations = n(row.activations);
  const pass = n(row.vlm_pass);
  const fail = n(row.vlm_fail);

  const caveats: string[] = [
    'All figures are actuals. FibreFlow holds no maintained schedule (progress_percentage is 0 on every project), so nothing here says whether the project is ahead of or behind plan.',
  ];
  if (sow === 0 && poles > 0) {
    caveats.push(
      `No SOW scope is imported for this project, yet ${poles} poles are recorded. Completion percentages are withheld rather than shown as 0%.`,
    );
  }
  if (poles === 0 && sow > 0) {
    caveats.push(
      `${sow} drops are in scope but no poles have been captured. That may mean work has not started, or that capture has not begun — this data cannot tell them apart.`,
    );
  }
  if (n(row.poles_approved) === 0 && poles > 0) {
    caveats.push(
      `None of the ${poles} poles are approved, so any approval-gated export (for example the works-QA PON zip) returns nothing unless it is asked to include unapproved poles.`,
    );
  }

  return {
    project: {
      id: row.project_id,
      name: row.project_name,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
    },
    scope: { sowDrops: measure(sow) },
    build: {
      poles: measure(poles),
      withAfterPhoto: measure(n(row.poles_after_photo)),
      approved: measure(n(row.poles_approved)),
      completion: ratio(poles, sow, row.status),
      throughput: throughput(
        n(row.poles_last_7d),
        n(row.poles_prior_7d),
        sow > 0 ? Math.max(sow - poles, 0) : null,
      ),
      newestPoleAt: row.newest_pole_at,
    },
    quality: {
      slotsPassed: measure(pass),
      slotsFailed: measure(fail),
      slotsUnscored: measure(n(row.vlm_unscored)),
      passRate: ratio(pass, pass + fail, row.status),
    },
    activations: {
      total: measure(activations),
      last7Days: measure(n(row.activations_last_7d)),
      completion: ratio(activations, sow, row.status),
    },
    photos: {
      worksQa: measure(n(row.works_qa_photos)),
      constructionQa: measure(n(row.qa_photos)),
      qfield: measure(n(row.qfield_photos)),
      // Deliberately NOT deduplicated: 3,575 keys are shared between construction-QA and
      // works-QA, so this is an upper bound. The per-store figures are the honest ones.
      total: n(row.works_qa_photos) + n(row.qa_photos) + n(row.qfield_photos),
    },
    outstanding: {
      openSnags: measure(n(row.open_snags)),
      purchaseOrders: measure(n(row.purchase_orders)),
    },
    caveats,
  };
}
