/**
 * Does the rule actually publish anything?
 *
 * The design before this one was provably tighter than its predecessors and
 * measured 82% of cells WITHHELD on an ordinary month. A disclosure control that
 * suppresses everything is trivially safe and worth nothing, so the usable
 * fraction is a test rather than a hope, and it is measured on the month a
 * customer actually has: one project, three sites, twenty staff, a month of
 * ordinary presence, incidents, notifications and monitor runs.
 *
 * The number this asserts is a FLOOR. If a later change pushes it up, raise the
 * floor; if a change pushes it below, that is the change telling you it made the
 * output useless.
 */
import { describe, expect, it } from 'vitest';
import { calculateMonthly } from '../metricCalculator';
import { releaseAnonymousGroups, releaseTiers } from '../suppression';
import { COMPONENT_OF } from '../metricRelations';
import { belowThresholdMonth, realisticMonth } from './factFixtures';

/**
 * Set from the measurement, not from a wish, and raised whenever the
 * measurement rises.
 *
 * It was 0.25 under the rule that took the MINIMUM tier over the projects: the
 * small project failed FULL, so the organisation published nothing at all. The
 * virtual-cell rule asks instead whether the projects being left behind are
 * safe to leave behind, and the same fixture now reaches 80%.
 */
const FLOOR = 0.7;

const COMPONENT_ROOT_OF = new Map(
  [...COMPONENT_OF.entries()].map(([key, component]) => [key, component.root]),
);

const K = 5;

/**
 * A row that tells a reader something.
 *
 * Every `timing.*` row fails this: the calculator puts the observation count in
 * the histogram, and migration 527's view publishes no histogram column, so what
 * survives is a metric key with a zero beside it. Counting those as published
 * would flatter the measurement by four components at every level. Median
 * estimation is an internal capability now — see the disclosure note.
 */
const informational = (row: { numerator: number; denominator: number | null }): boolean =>
  row.numerator !== 0 || row.denominator !== null;

describe('a realistic month publishes something worth reading', () => {
  it('reaches the floor of components that can carry information', () => {
    const siteMonths = calculateMonthly(realisticMonth(), K);
    const rows = releaseAnonymousGroups(siteMonths, K).filter(informational);
    const tiers = [...releaseTiers(siteMonths, K).entries()].filter(([id]) => !id.includes('|site|'));
    // A tier above NONE is not the same as a row that says something. The
    // incident component is rooted on `incident.total`, which no metric key can
    // carry, so TOTAL_ONLY publishes nothing there; and a timing row carries
    // nothing through this view at all. Both are counted as not published.
    const withRows = new Set(rows.map(
      (row) => `${row.monthStart}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}`
        + `|${COMPONENT_ROOT_OF.get(row.metricKey)}`,
    ));
    const carriers = tiers.filter(([id]) => !id.includes('|timing.'));
    const published = carriers.filter(([id]) => withRows.has(id));
    const fraction = published.length / carriers.length;
    console.log(
      `[usability] ${published.length}/${carriers.length} organisation+project components carrying `
      + `information publish (${(fraction * 100).toFixed(1)}%); `
      + `${published.length}/${tiers.length} of all components (${(published.length / tiers.length * 100).toFixed(1)}%); `
      + `full=${tiers.filter(([, tier]) => tier === 'full').length} `
      + `total_only=${tiers.filter(([, tier]) => tier === 'total_only').length}; `
      + `${rows.length} informational rows`,
    );
    expect(carriers.length).toBeGreaterThan(0);
    expect(fraction).toBeGreaterThanOrEqual(FLOOR);
  });

  it('publishes organisation and project rows, and none below them', () => {
    const rows = releaseAnonymousGroups(calculateMonthly(realisticMonth(), K), K).filter(informational);
    const levels = new Set(rows.map((row) => row.dimensionLevel));
    console.log(`[usability] ${rows.length} informational rows across levels: ${[...levels].sort().join(', ') || 'none'}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(levels.has('project')).toBe(true);
    expect(levels.has('organisation')).toBe(true);
    expect(levels.has('site')).toBe(false);
  });

  it('goes quiet at the organisation when a project is below the threshold outright', () => {
    // Four people. The residual an organisation row would leave is those four,
    // whatever rule is applied — so this is `k` refusing, not the rule being
    // lossy, and it is the one case the virtual cell cannot rescue.
    const rows = releaseAnonymousGroups(calculateMonthly(belowThresholdMonth(), K), K).filter(informational);
    const levels = new Set(rows.map((row) => row.dimensionLevel));
    console.log(`[usability] with a four-person project: ${rows.length} informational rows across ${[...levels].sort().join(', ') || 'none'}`);
    expect(levels.has('project')).toBe(true);
    expect(levels.has('organisation')).toBe(false);
  });
});
