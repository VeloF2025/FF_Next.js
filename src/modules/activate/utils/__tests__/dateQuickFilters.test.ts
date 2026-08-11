import { describe, it, expect } from 'vitest';

import {
  getMonthToDateRange,
  resolveActiveQuickFilter,
  type DateRange,
  type QuickDateFilter,
} from '../dateQuickFilters';

describe('getMonthToDateRange', () => {
  it('spans the 1st of the month through the given day', () => {
    expect(getMonthToDateRange('2026-08-08')).toEqual({ from: '2026-08-01', to: '2026-08-08' });
  });

  it('is inclusive on the 1st, so the range is that single day', () => {
    expect(getMonthToDateRange('2026-08-01')).toEqual({ from: '2026-08-01', to: '2026-08-01' });
  });

  it('stays inside the month at a year boundary', () => {
    expect(getMonthToDateRange('2026-01-15')).toEqual({ from: '2026-01-01', to: '2026-01-15' });
    expect(getMonthToDateRange('2025-12-31')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('derives the month from the SAST date string, never from the host clock', () => {
    // The input is already SAST-normalised by getTodaySAST(); slicing the string
    // keeps it that way. Constructing a Date here would re-apply the host offset
    // and could roll the month back a day near midnight.
    expect(getMonthToDateRange('2026-03-01').from).toBe('2026-03-01');
  });
});

describe('resolveActiveQuickFilter', () => {
  const addDays = (isoDate: string, days: number): string => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  /**
   * Stands in for DrListPage's `quickFilterRange`, which closes over the real
   * clock and cannot be imported. `today` is the SAST date and `cycleStart` the
   * Monday of the current cycle, so a caller can reproduce any calendar shape —
   * including the ones where presets collide.
   *
   * Every branch must stay faithful to the production helper it represents,
   * because `resolveActiveQuickFilter` decides by comparing these ranges. A
   * branch returning a literal that can never match silently removes that
   * preset from the comparison and makes the test assert an outcome production
   * would not produce.
   */
  const rangesFor = (today: string, cycleStart: string) =>
    (filter: QuickDateFilter): DateRange => {
      switch (filter) {
        case 'today': return { from: today, to: today };
        // getYesterdaySAST() is getTodaySAST() minus one day.
        case 'yesterday': {
          const yesterday = addDays(today, -1);
          return { from: yesterday, to: yesterday };
        }
        case 'mtd': return getMonthToDateRange(today);
        // getCycleDates('current') ends at today, not at the cycle's Sunday.
        case 'currentCycle': return { from: cycleStart, to: today };
        // getCycleDates('previous') shifts both ends back a week, so it ends on
        // the Sunday before the current cycle's Monday.
        case 'previousCycle':
          return { from: addDays(cycleStart, -7), to: addDays(cycleStart, -1) };
        case 'all': return { from: '', to: '' };
      }
    };

  describe('when no button has been clicked, it infers from the range', () => {
    it('reports the preset whose range matches', () => {
      // Wed 2026-08-12, cycle began Mon 2026-08-10.
      const rangeFor = rangesFor('2026-08-12', '2026-08-10');
      expect(resolveActiveQuickFilter({ from: '2026-08-12', to: '2026-08-12' }, rangeFor, null)).toBe('today');
      expect(resolveActiveQuickFilter({ from: '2026-08-01', to: '2026-08-12' }, rangeFor, null)).toBe('mtd');
      expect(resolveActiveQuickFilter({ from: '2026-08-10', to: '2026-08-12' }, rangeFor, null)).toBe('currentCycle');
    });

    it('reports "all" for an empty range and for a hand-picked one', () => {
      const rangeFor = rangesFor('2026-08-12', '2026-08-10');
      expect(resolveActiveQuickFilter({ from: '', to: '' }, rangeFor, null)).toBe('all');
      expect(resolveActiveQuickFilter({ from: '2026-04-02', to: '2026-06-17' }, rangeFor, null)).toBe('all');
    });
  });

  describe('collisions: distinct presets producing an identical range', () => {
    it('distinguishes today / mtd / currentCycle on Monday the 1st, when all three are the same range', () => {
      // Mon 2026-06-01 is both the 1st of the month and a cycle start, so every
      // one of these presets yields {2026-06-01, 2026-06-01}. Inference alone
      // can only ever name one of them.
      const rangeFor = rangesFor('2026-06-01', '2026-06-01');
      const collided = { from: '2026-06-01', to: '2026-06-01' };
      expect(rangeFor('today')).toEqual(collided);
      expect(rangeFor('mtd')).toEqual(collided);
      expect(rangeFor('currentCycle')).toEqual(collided);

      expect(resolveActiveQuickFilter(collided, rangeFor, 'today')).toBe('today');
      expect(resolveActiveQuickFilter(collided, rangeFor, 'mtd')).toBe('mtd');
      expect(resolveActiveQuickFilter(collided, rangeFor, 'currentCycle')).toBe('currentCycle');
    });

    it('distinguishes mtd from currentCycle all week when the 1st is a Monday', () => {
      // Cycle started Mon 2026-06-01; it is now Thu the 4th. currentCycle is
      // {1st, today} and mtd is {1st, today} — identical until the cycle rolls.
      const rangeFor = rangesFor('2026-06-04', '2026-06-01');
      const collided = { from: '2026-06-01', to: '2026-06-04' };
      expect(rangeFor('mtd')).toEqual(collided);
      expect(rangeFor('currentCycle')).toEqual(collided);

      expect(resolveActiveQuickFilter(collided, rangeFor, 'mtd')).toBe('mtd');
      expect(resolveActiveQuickFilter(collided, rangeFor, 'currentCycle')).toBe('currentCycle');
    });
  });

  describe('a recorded choice is verified, not trusted', () => {
    it('falls back to inference once the range no longer matches the click', () => {
      // QaCentrePage writes the same shared filters, so the recorded choice can
      // be left describing a range the user is no longer looking at.
      const rangeFor = rangesFor('2026-08-12', '2026-08-10');
      expect(resolveActiveQuickFilter({ from: '2026-08-12', to: '2026-08-12' }, rangeFor, 'mtd')).toBe('today');
    });

    it('falls back to "all" when the range matches no preset at all', () => {
      const rangeFor = rangesFor('2026-08-12', '2026-08-10');
      expect(resolveActiveQuickFilter({ from: '2026-04-02', to: '2026-06-17' }, rangeFor, 'mtd')).toBe('all');
    });

    it('drops a recorded choice the wall clock has moved past', () => {
      // Clicked "today" on the 12th; the tab was left open past midnight, so
      // 'today' now means the 13th and the recorded choice no longer describes
      // {12th, 12th}. The range is unchanged, so what it now describes is
      // yesterday — which is what the user is in fact still looking at.
      //
      // Scope: this proves the resolver returns the right answer WHEN CALLED
      // with a rangeFor built from the new date. It cannot prove DrListPage
      // actually calls it again after midnight — that depends on the component
      // recomputing rather than memoising, and there is no test covering the
      // component's render path (DrListPage has no test file). Memoising this
      // call is what made it stale once already; see the comment at the call
      // site before adding one back.
      const rangeFor = rangesFor('2026-08-13', '2026-08-10');
      expect(resolveActiveQuickFilter({ from: '2026-08-12', to: '2026-08-12' }, rangeFor, 'today')).toBe('yesterday');
    });
  });
});
