import type { MetricDefinition } from './types';

/**
 * The metric registry.
 *
 * Three deliberately different shapes, to prove the contract generalises:
 *   zone_uptake            — pre-aggregated table
 *   install_activation_gap — derived join
 *   pp_open_balance        — point-in-time snapshot (Task 1)
 *
 * Adding a metric here automatically enrols it in
 * `tests/migrations/metric-sql-executes.test.ts`, which runs its SQL against the
 * live schema for every declared grain x dimension.
 */
export const METRICS: readonly MetricDefinition[] = [
  {
    key: 'zone_uptake',
    label: 'zone uptake',
    description:
      'Cumulative installed drops per zone and PON, as at each billing week. A running total, not a weekly delta.',
    // ⚠️ `installed` is CUMULATIVE (migration 276 line 4 and the table comment).
    // Measured on the live DB 2026-08-02 for July: the weekly series runs
    // 21,666 -> 22,556 -> 23,342 -> 23,732, and summing it gives 91,296 against
    // a true 23,732. 'semi-additive' makes executeMetric report the LAST
    // period's value as the total instead of a sum. Within a single week_ending,
    // summing across zones IS correct — that is what the per-period aggregate
    // does. Grains are therefore restricted to week; 'month' is deliberately
    // absent because a month is several running totals collapsed into one.
    // The project column here is `project_name`, NOT `project`.
    from: `(
      SELECT src0.week_ending,
             src0.project_name AS project,
             src0.zone_no,
             src0.installed
      FROM project_weekly_zone_pon_uptake src0
    ) src`,
    measure: 'sum(src.installed)',
    dateColumn: 'src.week_ending',
    additivity: 'semi-additive',
    grains: ['week'],
    dimensions: ['project', 'zone'],
    aliases: ['zone uptake', 'uptake', 'installed per zone', 'homes installed'],
    cite: 'FibreFlow project_weekly_zone_pon_uptake (cumulative installed, latest week in range) by week_ending',
    permission: 'analytics.reports',
  },
  {
    key: 'install_activation_gap',
    label: 'installed but not activated',
    description:
      'Drops with an install recorded but no OES activation — work done and paid for that never went live.',
    // ⚠️ This is a PORT of the existing definition in
    // `pages/api/activate/reporting/installation-gaps.ts`, NOT a re-derivation.
    // Do not "simplify" it back to `drops LEFT JOIN oes_activations`. Two reasons,
    // both verified against the live DB:
    //   1. `drops` has no `project` column (it has `project_id uuid` -> `projects`),
    //      so `d.project` errors with "column d.project does not exist".
    //   2. `drops.created_at` is the SOW-import timestamp, not the install date —
    //      June 2026 shows 3,755 and July 2026 shows 9, which is import batching,
    //      not installation activity. The metric would be dimensionally valid and
    //      business-wrong.
    // The real definition lives on `dr_photo_unified_reviews`: installed = a WA
    // submission OR a 1Map installer name; not activated = `oes_activated_at IS NULL`;
    // the date basis is COALESCE(wa_received_at, created_at). `u.project` is free
    // text, so canonical_project() applies directly.
    // Verified 2026-08-02 for July: Mohadin 113, Lawley 26, Thembisa POP 1 6,
    // Etwatwa 5, Mamelodi 5.
    from: `(
      SELECT u.drop_number,
             u.project,
             COALESCE(u.wa_received_at, u.created_at) AS installed_at
      FROM dr_photo_unified_reviews u
      WHERE u.oes_activated_at IS NULL
        AND (u.wa_received_at IS NOT NULL OR u.installer_name IS NOT NULL)
    ) src`,
    measure: 'count(*)',
    dateColumn: 'src.installed_at',
    // Each row is one drop installed-but-not-activated on a given date: a
    // distinct event, so summing across days and projects is correct.
    additivity: 'additive',
    grains: ['day', 'week', 'month', 'range'],
    dimensions: ['project'],
    aliases: ['installation gap', 'installed not activated', 'activation gap', 'never went live'],
    cite: 'FibreFlow dr_photo_unified_reviews (oes_activated_at IS NULL AND installed via WA or 1Map) by COALESCE(wa_received_at, created_at)',
    permission: 'analytics.reports',
  },
  {
    key: 'pp_open_balance',
    label: 'open pre-provisions',
    description:
      'Point-in-time count of pre-provisions on the list and not yet activated, from the nightly snapshot.',
    from: `(
      SELECT s.as_of_date,
             s.dims->>'project'  AS project,
             s.dims->>'olt_name' AS olt_name,
             (s.measures->>'age_days')::int AS age_days
      FROM metric_snapshots s
      WHERE s.source_key = 'pp_open'
    ) src`,
    measure: 'count(*)',
    dateColumn: 'src.as_of_date',
    // A nightly STOCK, not an event count. The same DR appears in every night's
    // snapshot while it stays open, so summing across days counts one entity once
    // per night it was open — 1,061 open PPs over a week would report ~7,400.
    // 'semi-additive' makes the builder reject 'range' and the executor report the
    // latest night. Summing across project/POP within one night is still correct.
    additivity: 'semi-additive',
    grains: ['day'],
    dimensions: ['project', 'pop'],
    aliases: ['open pre-provisions', 'pp balance', 'pre-provision backlog', 'pp open'],
    cite: 'FibreFlow metric_snapshots (source_key=pp_open) by as_of_date',
    permission: 'analytics.reports',
  },
] as const;

export function findMetric(key: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.key === key);
}
