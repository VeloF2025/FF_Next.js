/**
 * The retention-hold panel and the operations analytics section must not invent
 * their own palettes.
 *
 * FibreFlow renders in a light theme. Tailwind's dark-only steps — `text-red-300`,
 * `bg-amber-900/30`, `border-red-800` — were written for a dark surface and
 * reach a light one as near-invisible text or a black-on-black badge. A
 * previous dialog shipped exactly that and nobody saw it in review, because
 * `getByText()` passes on text the eye cannot read: a class-name mistake is
 * invisible to every behavioural test in the suite.
 *
 * So this is a SOURCE comparison, not a render. It takes the colour utilities
 * of three components that have been in front of users — the review drawer,
 * the action panel and the chronology — as the proven vocabulary, and requires
 * the hold components to stay inside it. It is a pin, not a design rule: a new
 * colour is allowed the moment one of those siblings adopts it, which forces
 * the choice to be made somewhere it will actually be looked at.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..');

/** The components whose appearance has been reviewed against the real theme. */
const PROVEN = ['IncidentReviewDrawer.tsx', 'IncidentActionPanel.tsx', 'IncidentTimeline.tsx'];
const UNDER_TEST = [
  'RetentionHoldPanel.tsx', 'RetentionHoldRow.tsx', 'RetentionHoldCreateForm.tsx',
  // Stage 8 task 9. Every surface of the operations section that discloses
  // something — the error box, the freshness warning, the suppression notices,
  // the coverage flag, the drill-down failure — shipped in dark-only steps
  // (`bg-red-900/20`, `text-red-400`, `text-amber-400`) that reach this light
  // theme as near-invisible text on a black-on-black card. Exactly the failure
  // this file was written for, on the disclosures that most need to be read.
  'OperationsAnalytics.tsx', 'OperationsOverview.tsx', 'OperationsHistoryDrawer.tsx',
  'OperationsCharts.tsx', 'OperationsFilters.tsx',
];

/**
 * Every Tailwind utility that names a palette colour and a numeric step.
 * Deliberately shape-based rather than a denylist of the classes that were
 * wrong: a denylist passes the moment somebody reaches for `text-red-400`.
 */
const PALETTE_UTILITY = /(?:^|["'\s:{}`])((?:hover:|focus:|active:|disabled:|dark:)?(?:text|bg|border|ring|divide|from|via|to)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?:\/\d{1,3})?)/g;

function paletteUtilities(files: string[]): Set<string> {
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(WEB, file), 'utf8');
    for (const match of source.matchAll(PALETTE_UTILITY)) found.add(match[1]!);
  }
  return found;
}

describe('fleet incident web components use the reviewed palette', () => {
  it('names no colour utility the proven sibling components do not already use', () => {
    const allowed = paletteUtilities(PROVEN);
    const used = [...paletteUtilities(UNDER_TEST)];
    expect(used.filter((utility) => !allowed.has(utility))).toEqual([]);
  });

  /**
   * Guards the guard. If the sibling files ever stop carrying colour classes,
   * `allowed` becomes empty and the assertion above starts passing for the
   * wrong reason — it would be comparing against nothing.
   */
  it('has a non-empty reviewed vocabulary to compare against', () => {
    const allowed = paletteUtilities(PROVEN);
    expect(allowed.size).toBeGreaterThan(0);
    expect(allowed).toContain('text-red-700');
  });

  /** And the panel must actually be using some of it, or the pin is vacuous. */
  it('finds colour utilities in the components under test at all', () => {
    expect(paletteUtilities(UNDER_TEST).size).toBeGreaterThan(0);
  });
});
