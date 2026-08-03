/**
 * Execution test for the metric registry — real SQL against a real Postgres.
 *
 * Unit tests assert on the SQL *text* the builder emits, which is structurally
 * blind to everything Postgres decides at parse time and at grouping time. Three
 * classes of bug live in that blind spot, and all three are silent:
 *
 *   1. A definition whose `from`/`measure`/`dateColumn` does not match the real
 *      schema. That surfaces as a 500 at request time, not at build time — the
 *      42P08 class that once shipped past green CI and five reviewers.
 *
 *   2. GROUP BY resolving a dimension alias to the RAW input column instead of
 *      the canonicalised expression, splitting one project across several rows
 *      that all carry the SAME label. That does not error; it under-reports.
 *
 *   3. A missing snapshot being reported as a zero rather than as absence.
 *
 * The scratch-schema fixture lives in ./setup/metric-registry-fixture.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import { METRICS, findMetric } from '@/modules/metrics/registry';
import { buildMetricQuery } from '@/modules/metrics/registry/queryBuilder';
// From ./series, NOT ./execute: ES imports are hoisted above the DATABASE_URL
// assignment above, and execute.ts builds a pool at module scope (lib/db.mjs
// throws at import when DATABASE_URL is unset). These are the same functions —
// execute.ts imports and re-exports them.
import { toSeries, summarise } from '@/modules/metrics/registry/series';
import {
  createPool,
  scoped,
  setupFixture,
  teardownFixture,
} from './setup/metric-registry-fixture';

let pool: Pool;
const run = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  scoped<T>(pool, sql, params);

beforeAll(async () => {
  pool = createPool();
  await setupFixture(pool);
});

afterAll(async () => {
  await teardownFixture(pool);
});

const RANGE = { from: '2026-07-01', to: '2026-07-31' };

describe('every registered metric executes against a real schema', () => {
  for (const def of METRICS) {
    it(`${def.key} runs for each declared grain and dimension`, async () => {
      let ran = 0;
      for (const grain of def.grains) {
        // No dimensions, then each declared dimension on its own, then all together.
        const combos: string[][] = [[], ...def.dimensions.map((d) => [d]), [...def.dimensions]];
        for (const dimensions of combos) {
          const { sql, params } = buildMetricQuery(def, { ...RANGE, grain, dimensions });
          expect(Array.isArray(await run(sql, params))).toBe(true);
          ran++;
        }
      }
      // Guards the loop itself: a metric that declared no grains would otherwise
      // "pass" having executed nothing.
      expect(ran).toBeGreaterThan(0);
    });
  }
});

describe('grouping is by expression, not by output alias', () => {
  it('groups a canonicalised dimension into ONE row per period', async () => {
    // ⚠️ The regression this file exists for. 'TEM' and 'Thembisa POP 1' are two
    // raw spellings of one project. Grouping by the ALIAS `project` makes
    // PostgreSQL group by the raw src.project (input columns outrank output
    // aliases in GROUP BY), producing two rows that BOTH read 'Thembisa POP 1'
    // with the count split 1/1 instead of one row with 2. Nothing errors.
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, {
      ...RANGE,
      grain: 'month',
      dimensions: ['project'],
    });
    const series = toSeries(await run(sql, params), ['project']);

    const thembisa = series.filter((p) => p.dimensions.project === 'Thembisa POP 1');
    expect(thembisa).toHaveLength(1);
    expect(thembisa[0]!.value).toBe(2);

    // Stated as an invariant too, so any future dimension is covered: no two rows
    // may share the same (period, dimension values).
    const keys = series.map((p) => `${p.period}|${JSON.stringify(p.dimensions)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('additivity decides the headline number', () => {
  it('reports the LAST week for a cumulative metric, not the sum of weeks', async () => {
    // The single assertion this whole field exists for. The seeded weeks are the
    // real July 2026 production figures: 21,666 / 22,556 / 23,342 / 23,732.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'week', dimensions: [] });
    const series = toSeries(await run(sql, params), []);
    expect(series.map((p) => p.value)).toEqual([21666, 22556, 23342, 23732]);

    const { total, totalPeriod } = summarise(def, series);
    expect(total).toBe(23732);
    expect(total).not.toBe(91296); // the sum — the wrong answer, spelled out
    expect(totalPeriod).toBe('2026-07-20'); // date_trunc('week') → the Monday
  });

  it('sums freely for an additive metric', async () => {
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const { total, totalPeriod } = summarise(def, toSeries(await run(sql, params), []));
    // DR001, DR002, DR003, DR006. DR004 is activated and DR005 was never
    // installed, so both are excluded by the definition's own predicate.
    expect(total).toBe(4);
    expect(totalPeriod).toBeNull();
  });

  it('counts a nightly stock once, at the latest night', async () => {
    const def = findMetric('pp_open_balance')!;
    const { sql, params } = buildMetricQuery(def, {
      from: '2026-07-30',
      to: '2026-07-31',
      grain: 'day',
      dimensions: [],
    });
    const series = toSeries(await run(sql, params), []);
    expect(series.map((p) => p.period)).toEqual(['2026-07-30', '2026-07-31']);
    const { total, totalPeriod } = summarise(def, series);
    // The latest night alone (2 entities), NOT 1 + 2 = 3, which would count PP-1
    // twice for being open on two nights.
    expect(total).toBe(2);
    expect(totalPeriod).toBe('2026-07-31');
  });
});

describe('a missing snapshot is absence, not zero', () => {
  const def = () => findMetric('pp_open_balance')!;
  const forRange = async (from: string, to: string) => {
    const { sql, params } = buildMetricQuery(def(), { from, to, grain: 'day', dimensions: [] });
    return toSeries(await run(sql, params), []);
  };

  it('reports 0 for a night that WAS captured and was genuinely empty', async () => {
    // 2026-07-29 has a snapshot_runs row and no metric_snapshots rows.
    const series = await forRange('2026-07-29', '2026-07-29');
    expect(series).toHaveLength(1);
    expect(series[0]!.value).toBe(0);
    expect(summarise(def(), series).totalPeriod).toBe('2026-07-29');
  });

  it('omits a night that was never captured, rather than reporting it as 0', async () => {
    // ⚠️ 2026-07-28 has no pp_open run. If the metric read metric_snapshots
    // directly, "never captured" and "captured, nothing open" would both be an
    // empty series and the API would answer a confident 0 either way. Driving
    // from snapshot_runs is what separates them.
    const series = await forRange('2026-07-28', '2026-07-28');
    expect(series).toHaveLength(0);
    // total_period null is the signal a consumer can act on: no night is named,
    // so the 0 total is "no data", not "a measured zero".
    expect(summarise(def(), series).totalPeriod).toBeNull();
  });

  it('emits a placeholder dimension member on a captured-but-empty night', async () => {
    // Documented artifact, pinned so it cannot change unnoticed. The coverage row
    // that lets an empty night report 0 has no entity, so a dimensioned request
    // groups its NULLs: canonical_project(NULL) is 'Unknown' and olt_name stays
    // null. The TOTAL is still correct (0) — but 'Unknown' is an artifact of the
    // coverage row, not a project that had open pre-provisions. The metric's
    // description says so. A future `coverage` field on the response would let
    // this row be dropped entirely; that belongs with the exceptions work.
    const { sql, params } = buildMetricQuery(def(), {
      from: '2026-07-29',
      to: '2026-07-29',
      grain: 'day',
      dimensions: ['project', 'pop'],
    });
    const series = toSeries(await run(sql, params), ['project', 'pop']);
    expect(series).toEqual([
      { period: '2026-07-29', dimensions: { project: 'Unknown', pop: null }, value: 0 },
    ]);
    expect(summarise(def(), series).total).toBe(0);
  });

  it('omits a night whose rows no longer match its recorded row_count', async () => {
    // ⚠️ 2026-07-27's run recorded 2 rows and only 1 survives. Trusting the
    // surviving rows would report 1 as fact; had BOTH been lost it would report a
    // confident 0 naming that date — strictly worse than reading metric_snapshots
    // directly, which at least returned absence. Damaged must read as unknown.
    const series = await forRange('2026-07-27', '2026-07-27');
    expect(series).toHaveLength(0);
    expect(summarise(def(), series).totalPeriod).toBeNull();
  });

  it('distinguishes all four states within one range', async () => {
    const series = await forRange('2026-07-27', '2026-07-31');
    // 07-27 damaged -> absent; 07-28 never captured -> absent;
    // 07-29 captured and empty -> a real 0.
    expect(series.map((p) => [p.period, p.value])).toEqual([
      ['2026-07-29', 0],
      ['2026-07-30', 1],
      ['2026-07-31', 2],
    ]);
  });

  it("does not borrow another source's rows on a shared date", async () => {
    // tickets_open has BOTH a run and a snapshot row on 2026-07-31 — a date
    // pp_open also captured. Keying the join on source_key as well as date is the
    // only thing keeping T-1 out of the count; putting the foreign rows on a date
    // pp_open never captured would make this test unfalsifiable, because the
    // WHERE clause alone would already exclude them.
    const rows = await run<{ c: string }>(
      `SELECT count(*)::text c FROM metric_snapshots
       WHERE as_of_date = '2026-07-31' AND source_key = 'tickets_open'`,
    );
    expect(Number(rows[0]!.c)).toBe(1); // the foreign row is really there...
    const series = await forRange('2026-07-31', '2026-07-31');
    expect(series[0]!.value).toBe(2); // ...and pp_open still counts only its own 2
  });
});

describe('date bounds and period rendering', () => {
  it('includes rows landing on the final day of the range', async () => {
    // DR006 is at 23:59 SAST on the `to` date. BETWEEN would resolve the upper
    // bound to midnight and silently drop it; the half-open bound keeps it.
    const def = findMetric('install_activation_gap')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const periods = toSeries(await run(sql, params), []).map((p) => p.period);
    expect(periods).toContain('2026-07-31');
  });

  it('renders period as an ISO string, never a stringified Date', async () => {
    // `String(pgDate).slice(0,10)` yields "Mon Jul 21". to_char is what stops it.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'week', dimensions: [] });
    for (const point of toSeries(await run(sql, params), [])) {
      expect(typeof point.period).toBe('string');
      expect(point.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('returns a numeric dimension as a string, matching the declared type', async () => {
    // zone_no is INTEGER and node-postgres marshals it to a JS number, so without
    // the String() coercion in toSeries the response would carry `"zone": 1` while
    // MetricSeriesPoint declares `Record<string, string | null>`.
    const def = findMetric('zone_uptake')!;
    const { sql, params } = buildMetricQuery(def, {
      ...RANGE,
      grain: 'week',
      dimensions: ['zone'],
    });
    const series = toSeries(await run(sql, params), ['zone']);
    expect(series.length).toBeGreaterThan(0);
    for (const point of series) expect(point.dimensions.zone).toBe('1');
  });
});

describe('metrics restored from the deleted Cortex catalogue', () => {
  // SQL validity is already covered — every registered metric is enrolled above. These
  // pin the VALUES, because a predicate silently dropped from `from` still executes.

  it('counts only Active activations', async () => {
    const def = findMetric('activations')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const { total } = summarise(def, toSeries(await run(sql, params), []));
    expect(total).toBe(2); // 3 would mean the Cancelled row leaked in
  });

  it('reports open snags as a current-state count with no period', async () => {
    const def = findMetric('open_snags')!;
    // Deliberately request a window: a current-state metric must IGNORE it. If a date
    // filter ever appears in `from`, this assertion changes and the test fails.
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const series = toSeries(await run(sql, params), []);
    expect(series).toHaveLength(1);
    expect(series[0]!.period).toBeNull(); // NULL::text — drives the "(current)" wording
    const { total, totalPeriod } = summarise(def, series);
    expect(total).toBe(3); // open + in_progress + the NULL-status row
    expect(totalPeriod).toBeNull();
  });

  it('reports open tickets the same way', async () => {
    const def = findMetric('open_tickets')!;
    const { sql, params } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    const series = toSeries(await run(sql, params), []);
    const { total, totalPeriod } = summarise(def, series);
    expect(total).toBe(3); // open + assigned + NULL
    expect(totalPeriod).toBeNull();
  });

  it('ignores the requested window entirely for a current-state metric', async () => {
    // Same metric, a window that shares no days with the seeded data. A date-filtered
    // metric would return 0; a current-state one must still report the live count.
    const def = findMetric('open_snags')!;
    const { sql, params } = buildMetricQuery(def, {
      from: '2020-01-01', to: '2020-01-02', grain: 'day', dimensions: [],
    });
    const { total } = summarise(def, toSeries(await run(sql, params), []));
    expect(total).toBe(3);
  });

  it('counts a NULL status as open rather than silently dropping it', async () => {
    // `NULL NOT IN ('closed',...)` is unknown, not true, so a bare NOT IN discards the
    // row — under-reporting the very thing the metric counts. Neither column has a NOT
    // NULL constraint, so this is one bad insert away from being live.
    const def = findMetric('open_snags')!;
    const { sql } = buildMetricQuery(def, { ...RANGE, grain: 'day', dimensions: [] });
    expect(sql).toContain('IS NULL');
    const [row] = await run(
      `SELECT count(*)::int AS n FROM snags WHERE status IS NULL`, [],
    );
    expect((row as { n: number }).n).toBe(1); // the fixture seeds exactly one
  });
});
