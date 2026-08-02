import { describe, it, expect } from 'vitest';
import { buildMetricQuery, validateMetricQuery } from '../queryBuilder';
import { findMetric } from '../index';

const zoneUptake = findMetric('zone_uptake')!;
const gap = findMetric('install_activation_gap')!;
const ppOpen = findMetric('pp_open_balance')!;
const base = { from: '2026-07-01', to: '2026-07-31', dimensions: [] as string[] };

/** The GROUP BY line of a generated statement, without the keyword. */
function groupByOf(sql: string): string {
  const line = sql.split('\n').find((l) => l.startsWith('GROUP BY'));
  return line ? line.slice('GROUP BY '.length) : '';
}

describe('buildMetricQuery', () => {
  it('parametrizes dates rather than interpolating them', () => {
    const { sql, params } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    expect(sql).not.toContain('2026-07-01');
    expect(params).toEqual(['2026-07-01', '2026-07-31']);
  });

  it('emits a period column so the caller gets a series, not just a total', () => {
    const { sql } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    expect(sql).toContain('date_trunc');
    expect(sql).toContain('GROUP BY');
  });

  it('renders the period as text, never as a date', () => {
    // node-postgres marshals a DATE (OID 1082) into a JS Date, and String()ing
    // that yields "Mon Jul 21" rather than an ISO date — which would corrupt
    // `period` and break the lexical max the semi-additive total depends on.
    const { sql } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    expect(sql).toContain("to_char(date_trunc('week', src.week_ending), 'YYYY-MM-DD') AS period");
  });

  it('bounds the range half-open rather than with BETWEEN', () => {
    // BETWEEN resolves the upper bound to midnight and silently drops ~24h of the
    // final day on a timestamp column.
    const { sql } = buildMetricQuery(gap, { ...base, grain: 'day' });
    expect(sql).toContain('src.installed_at >= $1::date AND src.installed_at < ($2::date + 1)');
    expect(sql).not.toContain('BETWEEN');
  });

  it('groups by the dimension EXPRESSION, never by the output alias', () => {
    // ⚠️ Regression guard. PostgreSQL resolves an unqualified GROUP BY name to an
    // INPUT column before an output alias, and every dimension alias collides with
    // a column `src` already exposes. `GROUP BY project` therefore groups by the
    // RAW src.project, splitting one canonical project across several rows that
    // all carry the SAME label. Measured on live data: install_activation_gap by
    // month returned Thembisa POP 1 twice for 2026-05 (1 and 1) instead of once
    // with 2, because dr_photo_unified_reviews holds both 'TEM' and
    // 'Thembisa POP 1'. It does not error — it just under-reports.
    const { sql } = buildMetricQuery(gap, { ...base, grain: 'month', dimensions: ['project'] });
    const groupBy = groupByOf(sql);
    expect(groupBy).toContain('canonical_project(src.project::text)');
    // ...and no bare `project` survives as a group item of its own.
    expect(groupBy.split(',').map((s) => s.trim())).not.toContain('project');
  });

  it('groups by the period expression, not the period alias', () => {
    const { sql } = buildMetricQuery(zoneUptake, { ...base, grain: 'week' });
    const groupBy = groupByOf(sql);
    expect(groupBy).toContain("to_char(date_trunc('week', src.week_ending), 'YYYY-MM-DD')");
    expect(groupBy.split(',').map((s) => s.trim())).not.toContain('period');
  });

  it('rejects an unknown dimension instead of ignoring it', () => {
    expect(() =>
      buildMetricQuery(zoneUptake, { ...base, grain: 'week', dimensions: ['nonsense'] }),
    ).toThrow(/unsupported dimension/i);
  });

  it('rejects a dimension the metric does not declare, even if globally valid', () => {
    // 'pop' is a registered dimension — just not one zone_uptake exposes.
    expect(() =>
      buildMetricQuery(zoneUptake, { ...base, grain: 'week', dimensions: ['pop'] }),
    ).toThrow(/unsupported dimension/i);
  });

  it('rejects a grain the metric does not declare', () => {
    expect(() => buildMetricQuery(zoneUptake, { ...base, grain: 'day' })).toThrow(
      /unsupported grain/i,
    );
  });

  it('refuses the range grain on a semi-additive metric', () => {
    // Collapsing a running total or a nightly stock into one bucket sums values
    // that are not summable over time.
    //
    // Driven by a STUB, not by pp_open_balance: no registered metric both is
    // semi-additive and offers 'range' (registry.test.ts forbids that pairing),
    // so a registered metric would trip the earlier `grains` check and this
    // branch would never execute — a test that cannot reach what it claims to
    // cover is not a test.
    const semiAdditiveOfferingRange = { ...ppOpen, grains: ['range'] as const };
    expect(() => buildMetricQuery(semiAdditiveOfferingRange, { ...base, grain: 'range' })).toThrow(
      /unsupported grain 'range' for semi-additive/i,
    );
  });

  it('allows the range grain on an additive metric and drops the period column', () => {
    const { sql } = buildMetricQuery(gap, { ...base, grain: 'range' });
    expect(sql).toContain('NULL::text AS period');
    expect(sql).not.toContain('date_trunc');
  });

  it('validateMetricQuery applies the same rules the builder does', () => {
    // The API calls it standalone to answer 400 before the RBAC round-trip, so a
    // drift between the two would let a bad request through to execution.
    expect(() => validateMetricQuery(zoneUptake, { ...base, grain: 'day' })).toThrow(
      /unsupported grain/i,
    );
    expect(validateMetricQuery(zoneUptake, { ...base, grain: 'week', dimensions: ['zone'] })).toEqual(
      [expect.objectContaining({ key: 'zone' })],
    );
  });
});
