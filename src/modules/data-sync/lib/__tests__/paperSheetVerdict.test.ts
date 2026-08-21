/**
 * paperSheetVerdict — classifying serials scanned off historical paper sheets.
 *
 * Fixtures use the REAL distribution measured on the 21 May 2026 sheets, and
 * real serials from them, because the whole value of the feature is finding
 * the small contradicting group inside a large already-known one.
 */
import { describe, it, expect } from 'vitest';
import {
  verdictForPaperSerial,
  summarisePaperSheet,
  type PaperSheetSerial,
} from '../paperSheetVerdict';

describe('verdictForPaperSerial', () => {
  it('says nothing to do for a serial already recorded as activated', () => {
    expect(verdictForPaperSerial({ serialNumber: 'ALCLB48E1234', status: 'activated' }))
      .toBe('already-recorded');
  });

  it('treats issued and installed as already recorded too', () => {
    // All three mean the ONT has genuinely left the shelf.
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'issued' })).toBe('already-recorded');
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'installed' })).toBe('already-recorded');
  });

  it('FLAGS a serial the system still believes is on the shelf', () => {
    // ALCLB48F4F5A: in_stock at Mamelodi Pop1, but the 2026-05-11 sheet
    // records it handed out against DR1871183. A storeman could issue it
    // again today. This is the finding the feature exists for.
    expect(verdictForPaperSerial({ serialNumber: 'ALCLB48F4F5A', status: 'in_stock' }))
      .toBe('contradicts-stock');
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'available' }))
      .toBe('contradicts-stock');
  });

  it('reports a serial with no stock row as unknown', () => {
    expect(verdictForPaperSerial({ serialNumber: 'ALCLB49486FF', status: null }))
      .toBe('unknown-serial');
  });

  it('does not fold an unrecognised status into a known bucket', () => {
    // Guessing here would either hide a contradiction or invent one.
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'faulty' })).toBe('unclassified');
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'quarantine' })).toBe('unclassified');
    expect(verdictForPaperSerial({ serialNumber: 'X', status: '' })).toBe('unclassified');
  });

  it('distinguishes "no row" from "unrecognised status"', () => {
    // Both are "we cannot act", but they need different follow-up: one is a
    // missing serial, the other is a serial in a state we have no rule for.
    expect(verdictForPaperSerial({ serialNumber: 'X', status: null })).toBe('unknown-serial');
    expect(verdictForPaperSerial({ serialNumber: 'X', status: 'scrapped' })).toBe('unclassified');
  });
});

describe('summarisePaperSheet', () => {
  it('reproduces the measured May distribution', () => {
    // 137 activated, 43 absent, 10 believed in stock — the real numbers.
    const serials: PaperSheetSerial[] = [
      ...Array.from({ length: 137 }, (_, i) => ({ serialNumber: `A${i}`, status: 'activated' })),
      ...Array.from({ length: 43 }, (_, i) => ({ serialNumber: `U${i}`, status: null })),
      ...Array.from({ length: 10 }, (_, i) => ({ serialNumber: `C${i}`, status: 'in_stock' })),
    ];

    const summary = summarisePaperSheet(serials);

    expect(summary.total).toBe(190);
    expect(summary.alreadyRecorded).toBe(137);
    expect(summary.unknownSerial).toBe(43);
    expect(summary.contradictsStock).toBe(10);
    expect(summary.unclassified).toBe(0);
  });

  it('keeps per-serial detail so the contradictions can be named', () => {
    // A count alone is useless — someone has to go and find those ONTs.
    const summary = summarisePaperSheet([
      { serialNumber: 'ALCLB48E83D5', status: 'in_stock' },
      { serialNumber: 'ALCLB48E1234', status: 'activated' },
    ]);
    const flagged = summary.serials.filter((s) => s.verdict === 'contradicts-stock');
    expect(flagged.map((s) => s.serialNumber)).toEqual(['ALCLB48E83D5']);
  });

  it('handles an empty scan without dividing by anything', () => {
    const summary = summarisePaperSheet([]);
    expect(summary.total).toBe(0);
    expect(summary.serials).toEqual([]);
  });

  it('counts every serial exactly once across the buckets', () => {
    // A serial silently belonging to no bucket, or two, would make the
    // summary lie about a page the storeman is holding.
    const serials: PaperSheetSerial[] = [
      { serialNumber: 'a', status: 'activated' },
      { serialNumber: 'b', status: null },
      { serialNumber: 'c', status: 'in_stock' },
      { serialNumber: 'd', status: 'faulty' },
    ];
    const s = summarisePaperSheet(serials);
    expect(s.alreadyRecorded + s.unknownSerial + s.contradictsStock + s.unclassified)
      .toBe(s.total);
  });
});
