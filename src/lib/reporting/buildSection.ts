/**
 * Build progress: where capture has reached, and how fast it is moving.
 *
 * The per-slot breakdown is the useful part. A pole is not "done" when a row exists — it
 * is done when its 22 photo slots are filled, and the shape of the drop-off across those
 * slots says where the field process is stalling. Namakgale has 124 poles and 33 after
 * photos; that gap is the finding, and a pole count alone hides it.
 */
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';

import { measure, ratio, throughput, type Measure, type Ratio, type Throughput } from './coverage';
import { baseCaveats, CAPTURED_IN_PLAN, targetCte } from './projectTarget';

/** One row per slot: how many poles have that photo, generated from the trusted constant. */
const SLOT_UNION = SLOT_META.map(
  (s) =>
    `SELECT '${s.key}' AS slot, '${s.label.replace(/'/g, "''")}' AS label, ` +
    `'${s.discipline}' AS discipline, ${s.stepNumber} AS step, ` +
    `count(*) FILTER (WHERE ${s.dbColumn} IS NOT NULL)::bigint AS filled ` +
    `FROM pole_qa_photos WHERE project_id = (SELECT id FROM target)`,
).join('\n        UNION ALL\n        ');

export function buildSectionQuery(project: string): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  return {
    params,
    sql: `
      WITH ${targetCte(project, params)},
      scope AS (
        SELECT count(*)::bigint n FROM poles pl
        WHERE pl.project_id = (SELECT id FROM target)
          AND pl.status IS DISTINCT FROM 'cancelled'
      ),
      totals AS (
        SELECT count(*)::bigint AS poles,
               count(*) FILTER (WHERE ${CAPTURED_IN_PLAN})::bigint AS poles_in_plan,
               count(*) FILTER (WHERE approved_at IS NOT NULL)::bigint AS approved,
               count(*) FILTER (WHERE created_at >= now() - interval '7 days')::bigint AS last_7d,
               count(*) FILTER (WHERE created_at >= now() - interval '14 days'
                                  AND created_at <  now() - interval '7 days')::bigint AS prior_7d
        FROM pole_qa_photos w WHERE w.project_id = (SELECT id FROM target)
      ),
      slots AS (${SLOT_UNION}),
      -- Twelve weeks of capture, oldest last. date_trunc runs in the session timezone,
      -- so weeks are UTC-aligned; that is consistent across every project and is stated
      -- rather than silently assumed to be SAST.
      weekly AS (
        SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
               count(*)::bigint AS poles
        FROM pole_qa_photos
        WHERE project_id = (SELECT id FROM target)
          AND created_at >= now() - interval '12 weeks'
        GROUP BY 1 ORDER BY 1 DESC
      )
      SELECT t.project_name, t.status, m.n AS name_matches,
             scope.n AS pole_scope, totals.poles, totals.poles_in_plan, totals.approved,
             totals.last_7d, totals.prior_7d,
             (SELECT json_agg(json_build_object('slot', slot, 'label', label,
                'discipline', discipline, 'step', step, 'polesWithPhoto', filled)
                ORDER BY discipline, step) FROM slots) AS slot_progress,
             (SELECT json_agg(json_build_object('week', week, 'poles', poles) ORDER BY week DESC) FROM weekly) AS weekly
      FROM target t, matches m, scope, totals`,
  };
}

interface SlotProgress {
  slot: string;
  label: string;
  discipline: string;
  step: number;
  polesWithPhoto: string | number;
}

export interface BuildSectionRow {
  project_name: string;
  status: string | null;
  name_matches: string;
  pole_scope: string;
  poles: string;
  poles_in_plan: string;
  approved: string;
  last_7d: string;
  prior_7d: string;
  slot_progress: SlotProgress[] | null;
  weekly: Array<{ week: string; poles: string | number }> | null;
}

export interface BuildSection {
  project: string;
  poleScope: Measure;
  polesCaptured: Measure;
  /** Captures that match a live pole in the plan — the completion numerator. */
  polesCapturedInPlan: Measure;
  polesApproved: Measure;
  completion: Ratio;
  throughput: Throughput;
  slotProgress: Array<{ slot: string; label: string; discipline: string; polesWithPhoto: number; ofPoles: number }>;
  weeklyCapture: Array<{ week: string; poles: number }>;
  caveats: string[];
}

const n = (v: string | number | null | undefined): number => Number(v ?? 0);

export function shapeBuildSection(row: BuildSectionRow): BuildSection {
  const poles = n(row.poles);
  const inPlan = n(row.poles_in_plan);
  const scope = n(row.pole_scope);
  const caveats = baseCaveats(row.project_name, n(row.name_matches));

  const slotProgress = (row.slot_progress ?? []).map((s) => ({
    slot: s.slot,
    label: s.label,
    discipline: s.discipline,
    polesWithPhoto: n(s.polesWithPhoto),
    ofPoles: poles,
  }));

  // Range across ALL civil slots, not first-vs-last. Comparing the ends fired on every
  // project with any capture — the last civil slot is a recently-added Pole Label step
  // at ~14% fill everywhere — while staying silent on Mamelodi, whose funnel really is
  // broken (35 poles at step 1, 1,552 at step 7) because its last exceeded its first.
  // Stated as an observed range with no causal claim attached.
  const civil = slotProgress.filter((s) => s.discipline === 'civil');
  if (poles > 0 && civil.length > 1) {
    const highest = civil.reduce((a, b) => (b.polesWithPhoto > a.polesWithPhoto ? b : a));
    const lowest = civil.reduce((a, b) => (b.polesWithPhoto < a.polesWithPhoto ? b : a));
    if (highest.polesWithPhoto > 0 && lowest.polesWithPhoto < highest.polesWithPhoto / 2) {
      caveats.push(
        `Civil capture is uneven: ${highest.polesWithPhoto} poles have "${highest.label}" ` +
          `but only ${lowest.polesWithPhoto} have "${lowest.label}". That gap is a capture ` +
          'difference between steps; this data does not say why.',
      );
    }
  }
  if (poles > 0 && n(row.approved) === 0) {
    caveats.push(
      `None of the ${poles} captured poles are approved, so approval-gated exports return nothing unless asked to include unapproved poles.`,
    );
  }

  return {
    project: row.project_name,
    poleScope: measure(scope),
    polesCaptured: measure(poles),
    polesCapturedInPlan: measure(inPlan),
    polesApproved: measure(n(row.approved)),
    // Plan-matched, not the raw capture count: the two tables are independently
    // populated and share only a label, so raw/scope is not a completion ratio.
    completion: ratio(inPlan, scope, row.status),
    throughput: throughput(
      n(row.last_7d),
      n(row.prior_7d),
      scope > 0 ? Math.max(scope - inPlan, 0) : null,
    ),
    slotProgress,
    weeklyCapture: (row.weekly ?? []).map((w) => ({ week: w.week, poles: n(w.poles) })),
    caveats,
  };
}
