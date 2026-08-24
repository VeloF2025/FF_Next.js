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
import { realisticMonth } from './factFixtures';

const COMPONENT_ROOT_OF = new Map(
  [...COMPONENT_OF.entries()].map(([key, component]) => [key, component.root]),
);

const K = 5;
const FLOOR = 0.6;

describe('a realistic month publishes something worth reading', () => {
  it('reaches at least the floor of organisation and project components', () => {
    const siteMonths = calculateMonthly(realisticMonth(), K);
    const rows = releaseAnonymousGroups(siteMonths, K);
    const tiers = [...releaseTiers(siteMonths, K).entries()]
      .filter(([id]) => !id.includes('|site|'));
    // A tier above NONE is not the same as a row. The incident component is
    // rooted on `incident.total`, which no metric key can carry, so TOTAL_ONLY
    // publishes nothing there. Counting tiers rather than rows would flatter the
    // number by exactly that much, so the measure is components that actually
    // produced a row.
    const withRows = new Set(rows.map(
      (row) => `${row.monthStart}|${row.dimensionLevel}|${row.dimensionProjectId ?? ''}`
        + `|${COMPONENT_ROOT_OF.get(row.metricKey)}`,
    ));
    const published = tiers.filter(([id]) => withRows.has(id));
    const fraction = published.length / tiers.length;
    console.log(
      `[usability] ${published.length}/${tiers.length} organisation+project components publish `
      + `(${(fraction * 100).toFixed(1)}%); `
      + `full=${tiers.filter(([, tier]) => tier === 'full').length} `
      + `total_only=${tiers.filter(([, tier]) => tier === 'total_only').length}`,
    );
    expect(tiers.length).toBeGreaterThan(0);
    expect(fraction).toBeGreaterThanOrEqual(FLOOR);
  });

  it('publishes rows at both levels, and none below them', () => {
    const rows = releaseAnonymousGroups(calculateMonthly(realisticMonth(), K), K);

    const levels = new Set(rows.map((row) => row.dimensionLevel));
    console.log(`[usability] ${rows.length} rows released across ${levels.size} levels`);
    expect(levels.has('organisation')).toBe(true);
    expect(levels.has('project')).toBe(true);
    expect(levels.has('site')).toBe(false);
    expect(rows.length).toBeGreaterThan(0);
  });
});
