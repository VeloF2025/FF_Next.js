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
      'Point-in-time count of pre-provisions on the list and not yet activated, from the nightly ' +
      'snapshot. A night that was never captured, or whose rows no longer match its recorded ' +
      'row_count, is absent from the series rather than reported as zero — so a zero total with a ' +
      'null total_period means "no data", not "nothing open". Caveat: on a night that WAS captured ' +
      'and was genuinely empty, a dimensioned request returns one placeholder row (project ' +
      '"Unknown", pop null) carrying value 0; the total is still correct, but that member is an ' +
      'artifact of the coverage row, not a real project.',
    // ⚠️ Driven from snapshot_runs, LEFT JOINed to the rows — not from
    // metric_snapshots alone. Reading the rows directly makes "this night was
    // never captured" indistinguishable from "this night had nothing open":
    // both produce an empty series, and the API would answer a confident 0. For
    // a machine consumer that is the exact failure this platform exists to stop.
    //
    // With the run table as the driving side:
    //   night captured, 3 open   -> one row per entity           -> 3
    //   night captured, 0 open   -> one row, snapshot_id IS NULL -> 0
    //   night never captured     -> no rows at all               -> absent from
    //                               the series, so total_period does not name it
    //   night captured, rows since damaged -> also absent (see row_count below)
    //
    // The measure counts snapshot_id, NOT (*), because the LEFT JOIN's no-match
    // row is still a row and count(*) would report it as 1.
    //
    // ⚠️ The row_count equality is not decoration. Without it the join trusts
    // whatever rows survive: delete some of a completed night's snapshots and the
    // metric reports the remainder as fact, and delete ALL of them and it reports
    // a confident 0 *with that date as total_period* — strictly worse than
    // reading metric_snapshots directly, which at least returned absence. A run
    // whose recorded row_count no longer matches the rows present is damaged, and
    // damaged must read as unknown, never as a measured number.
    //
    // ⚠️ Depends on `snapshot_runs_source_date_key` being UNIQUE on
    // (source_key, as_of_date). The primary key is on `id`, so that index is the
    // only thing preventing two run rows for one night from fanning the join out
    // and double-counting every entity.
    from: `(
      SELECT r.as_of_date,
             s.id                AS snapshot_id,
             s.dims->>'project'  AS project,
             s.dims->>'olt_name' AS olt_name
      FROM snapshot_runs r
      LEFT JOIN metric_snapshots s
             ON s.source_key = r.source_key
            AND s.as_of_date = r.as_of_date
      WHERE r.source_key = 'pp_open'
        AND r.row_count = (
          SELECT count(*) FROM metric_snapshots m
          WHERE m.source_key = r.source_key AND m.as_of_date = r.as_of_date
        )
    ) src`,
    measure: 'count(src.snapshot_id)',
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

  // ─── Restored from Cortex's deleted in-code catalogue ────────────────────────
  //
  // These three answered precisely until Cortex PR #164 deleted `metrics_db.py`
  // wholesale. That was contrary to this plan's Task 7 Step 1 ("preprovisions stays
  // exactly as it is"), and the effect was silent: the questions still parsed as
  // numeric, found no registry metric, and fell through to RAG — so a numeric
  // question started getting a prose answer, which is the precise failure this
  // platform exists to remove.
  //
  // Registering them here rather than restoring the direct-SQL path keeps every read
  // behind FibreFlow's per-metric RBAC. Predicates live in `from` because
  // MetricDefinition has no `filter` field (deliberately removed — no metric used it).
  // ⚠️ `preprovisions` is DELIBERATELY NOT RESTORED. The old definition counted rows in
  // dr_activity_log where event_type IN ('pre_prov_added','pre_prov_reentered'), but that
  // table RE-LOGS an unresolved item roughly daily rather than once: measured 2026-08-03,
  // three drops carry 141 rows each spanning 2026-04-30..2026-07-12. For July that SQL
  // returns 1,107 against 264 distinct drops touched and 219 first-ever additions — a ~5x
  // overcount, the same "summing something that cannot be summed over time" failure as
  // zone_uptake, reached by re-logging instead of cumulative snapshotting.
  //
  // It is not restored because which number is meant (219 new / 264 touched / 1,107 events)
  // is a business decision, and the plan already schedules `pp_new` for Plan 2 to make it.
  // Until then the question falls through to prose, which is honest; a confident 1,107 is
  // not. Do not re-add it without a first-occurrence or DISTINCT basis and a value test.
  {
    key: 'activations',
    label: 'activations',
    description:
      'Drops activated on the OES, by activation date. ⚠️ Not a stable historical series: ' +
      'oes_activations is UNIQUE on drop_number and the importer upserts activation_date ' +
      'unconditionally, so a re-import can move a drop into a different day and re-running ' +
      'the same past range can return a different number.',
    from: `(
      SELECT src0.activation_date
      FROM oes_activations src0
      WHERE src0.status = 'Active'
    ) src`,
    measure: 'count(*)',
    dateColumn: 'src.activation_date',
    additivity: 'additive',
    grains: ['day', 'week', 'month', 'range'],
    dimensions: [],
    aliases: ['activations', 'activated', 'went live', 'oes activations'],
    cite: 'FibreFlow oes_activations (status=Active) by activation_date',
    permission: 'analytics.reports',
  },
  {
    key: 'open_snags',
    label: 'open snags',
    description:
      'Snags not yet closed, fixed or verified. A current-state count with no date dimension — it answers "right now", not "during a period".',
    from: `(
      SELECT src0.id
      FROM snags src0
      WHERE src0.status IS NULL OR src0.status NOT IN ('closed', 'fixed', 'verified')
    ) src`,
    measure: 'count(*)',
    // NULL: current-state-only. buildMetricQuery emits no WHERE date filter and no
    // period expression, so the requested window is ignored entirely and every row
    // lands in one undated bucket. summarise() then returns total_period=null, which
    // the client renders as "(current)" rather than stamping it with a date range.
    dateColumn: null,
    // A stock, not an event stream: the same snag is open on many days, so this could
    // never be summed over time even if it had a date column.
    additivity: 'semi-additive',
    // A periodic grain is required even though it is unused — validateMetricQuery
    // rejects 'range' for any non-additive measure, so 'day' is the only safe
    // declaration. It has no effect on the SQL because dateColumn is null.
    grains: ['day'],
    dimensions: [],
    aliases: ['open snags', 'snags', 'outstanding snags', 'unresolved snags'],
    cite: 'FibreFlow snags (open = not closed/fixed/verified), current state',
    permission: 'analytics.reports',
  },
  {
    key: 'open_tickets',
    label: 'open tickets',
    description:
      'Maintenance tickets not yet resolved, cancelled or verified. Current-state count, same shape as open_snags.',
    from: `(
      SELECT src0.id
      FROM maintenance_tickets src0
      WHERE src0.status IS NULL OR src0.status NOT IN ('resolved', 'cancelled', 'verified')
    ) src`,
    measure: 'count(*)',
    dateColumn: null,
    additivity: 'semi-additive',
    grains: ['day'],
    dimensions: [],
    aliases: ['open tickets', 'tickets', 'outstanding tickets', 'maintenance tickets'],
    cite: 'FibreFlow maintenance_tickets (open = not resolved/cancelled/verified), current state',
    permission: 'analytics.reports',
  },
] as const;

export function findMetric(key: string): MetricDefinition | undefined {
  return METRICS.find((m) => m.key === key);
}
