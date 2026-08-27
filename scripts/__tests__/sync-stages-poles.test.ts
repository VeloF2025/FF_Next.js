import { describe, expect, it } from 'vitest';

import { applyPoleFallback, shouldUsePolesTable } from '../lib/sync-stages-poles.mjs';

type PonAgg = {
  zone_no: number;
  pon_no: number;
  permissions: { total: number; complete: number };
  poles: { total: number; complete: number };
  cwc: { total: number; complete: number; firstDate: string | null; lastDate: string | null };
  activation: { total: number; complete: number };
};

function ponAgg(zone: number, pon: number, dropsTotal = 40): PonAgg {
  return {
    zone_no: zone,
    pon_no: pon,
    permissions: { total: 0, complete: 0 },
    poles: { total: 0, complete: 0 },
    cwc: { total: 0, complete: 0, firstDate: null, lastDate: null },
    activation: { total: dropsTotal, complete: 0 },
  };
}

function ponMapOf(...aggs: PonAgg[]): Map<string, PonAgg> {
  return new Map(aggs.map(a => [`${a.zone_no}-${a.pon_no}`, a]));
}

// Shape of the poles-table query in syncSite: pg returns the ::int counts as
// numbers and the ::text dates as strings.
const POP1_ROW = {
  zone_no: 3,
  pon_no: 7,
  poles: 112,
  planted: 18,
  cwc: 5,
  cwc_first: '2026-05-04',
  cwc_last: '2026-08-19',
};

describe('shouldUsePolesTable', () => {
  it('falls back when no drops row links a pole', () => {
    expect(shouldUsePolesTable([{ poles: 0 }, { poles: 0 }, { poles: 0 }])).toBe(true);
  });

  it('keeps the drops source when any PON links a pole', () => {
    // Lawley-shaped: `poles` over-counts (4,937 vs 2,994), so one linked PON is
    // enough to disqualify the whole project.
    expect(shouldUsePolesTable([{ poles: 0 }, { poles: 861 }, { poles: 0 }])).toBe(false);
  });

  it('does not fall back when the project has no PON rows at all', () => {
    expect(shouldUsePolesTable([])).toBe(false);
  });
});

describe('applyPoleFallback', () => {
  it('sets pole scope, planted and CWC from the poles table', () => {
    const agg = ponAgg(3, 7);
    const applied = applyPoleFallback(ponMapOf(agg), [POP1_ROW]);

    expect(agg.permissions.total).toBe(112);
    expect(agg.poles.total).toBe(112);
    expect(agg.cwc.total).toBe(112);
    expect(agg.poles.complete).toBe(18);
    expect(agg.cwc.complete).toBe(5);
    expect(agg.cwc.firstDate).toBe('2026-05-04');
    expect(agg.cwc.lastDate).toBe('2026-08-19');
    expect(applied).toEqual({ pons: 1, planted: 18, cwc: 5 });
  });

  it('leaves the drops-derived activation totals alone', () => {
    const agg = ponAgg(3, 7, 40);
    applyPoleFallback(ponMapOf(agg), [POP1_ROW]);

    expect(agg.activation.total).toBe(40);
    expect(agg.activation.complete).toBe(0);
  });

  it('skips PONs that hold poles but no drops', () => {
    const known = ponAgg(3, 7);
    const map = ponMapOf(known);
    const applied = applyPoleFallback(map, [
      POP1_ROW,
      { ...POP1_ROW, zone_no: 9, pon_no: 99, poles: 40, planted: 4, cwc: 1 },
    ]);

    expect(map.size).toBe(1);
    expect(known.poles.total).toBe(112);
    expect(applied).toEqual({ pons: 1, planted: 18, cwc: 5 });
  });

  it('leaves every aggregate untouched when the poles table returns nothing', () => {
    const agg = ponAgg(3, 7);
    const applied = applyPoleFallback(ponMapOf(agg), []);

    expect(agg).toEqual(ponAgg(3, 7));
    expect(applied).toEqual({ pons: 0, planted: 0, cwc: 0 });
  });

  it('records a PON with poles but nothing planted or audited', () => {
    // Themb'elihle: 1,808 poles, 0 planted, 0 CWC — the totals must still land.
    const agg = ponAgg(1, 2);
    const applied = applyPoleFallback(ponMapOf(agg), [
      { zone_no: 1, pon_no: 2, poles: 226, planted: 0, cwc: 0, cwc_first: null, cwc_last: null },
    ]);

    expect(agg.poles.total).toBe(226);
    expect(agg.poles.complete).toBe(0);
    expect(agg.cwc.complete).toBe(0);
    expect(agg.cwc.firstDate).toBeNull();
    expect(applied).toEqual({ pons: 1, planted: 0, cwc: 0 });
  });

  it('sums across every merged PON', () => {
    const a = ponAgg(3, 7);
    const b = ponAgg(3, 8);
    const applied = applyPoleFallback(ponMapOf(a, b), [
      POP1_ROW,
      { ...POP1_ROW, pon_no: 8, poles: 88, planted: 12, cwc: 3 },
    ]);

    expect(b.poles.total).toBe(88);
    expect(applied).toEqual({ pons: 2, planted: 30, cwc: 8 });
  });
});
