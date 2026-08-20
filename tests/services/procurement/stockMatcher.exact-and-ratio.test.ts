/**
 * Stock matching: exact names win, conflicting split ratios are refused.
 *
 * Both pin behaviour observed against real data on 2026-08-20, where the
 * matcher was asked to match unlinked purchase-order lines:
 *
 *   "1:16 Bare Fibre Splitter"  ->  SPLIT-BF-1-2   0.65   (picked)
 *                                   SPLIT-BF-1-8   0.65
 *                                   SPLIT-BF-1-16  0.62   (correct, ranked LAST)
 *
 * Nothing compared a description to a stock item's NAME — only codes were
 * matched exactly — so an identically-named item fell through to fuzzy
 * scoring, where normalised Levenshtein favours shorter names and the ratio
 * barely registers in keyword overlap. Receiving against that link would have
 * put 1:2 splitters into stock for a 1:16 delivery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = vi.hoisted(() => ({ stockItems: [] as Record<string, unknown>[] }));

vi.mock('@/lib/db-neon', () => ({
  neon: () => async (strings: TemplateStringsArray) => {
    const sql = strings.join('');
    if (/FROM stock_items/i.test(sql)) return rows.stockItems;
    return []; // supplier_item_codes
  },
  neonConfig: {},
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createStockMatcher,
  extractSplitRatio,
  ratiosConflict,
} from '@/services/procurement/import/stockMatcher';

const SPLITTERS = [
  { id: 'bf-2', item_code: 'SPLIT-BF-1-2', name: '1:2 Bare Fibre Splitter', description: '', category: 'optics' },
  { id: 'bf-8', item_code: 'SPLIT-BF-1-8', name: '1:8 Bare Fibre Splitter', description: '', category: 'optics' },
  { id: 'bf-16', item_code: 'SPLIT-BF-1-16', name: '1:16 Bare Fibre Splitter', description: '', category: 'optics' },
];

async function match(description: string, itemCode: string | null = null) {
  const matcher = createStockMatcher('postgres://unused');
  const [result] = await matcher.matchBatch([
    { id: 'line-1', itemCode, description, category: null },
  ]);
  return result!;
}

beforeEach(() => {
  rows.stockItems = [...SPLITTERS];
});

describe('extractSplitRatio', () => {
  it('reads a ratio from either notation', () => {
    expect(extractSplitRatio('1:16 Bare Fibre Splitter')).toBe('1:16');
    expect(extractSplitRatio('SPLIT-BF-1-16')).toBe('1:16');
    expect(extractSplitRatio('Splitter.Bare.SM.G657A1.1:8')).toBe('1:8');
  });

  it('is silent when there is no ratio to read', () => {
    expect(extractSplitRatio('M8 Wall plug')).toBeNull();
    expect(extractSplitRatio('')).toBeNull();
    expect(extractSplitRatio(null)).toBeNull();
  });

  it('does not read a decimal as a ratio', () => {
    // "1-16.5" is a measurement, not a 1:16 split.
    expect(extractSplitRatio('BRACKET-1-16.5')).toBeNull();
  });

  it('reads no ratio out of product codes that are not splitters', () => {
    // Both are real catalogue entries. CAB-AER-SM-13.1-288F is a 288-fibre
    // aerial cable whose decimal diameter and fibre count spell "1-288";
    // HDPE-1-85 is a 1-way 8/5mm microduct. Inventing a ratio from either
    // would veto correct matches — worse than never vetoing at all.
    expect(extractSplitRatio('CAB-AER-SM-13.1-288F')).toBeNull();
    expect(extractSplitRatio('HDPE-1-85')).toBeNull();
  });

  it('does not veto a cable against a splitter on an invented ratio', () => {
    expect(ratiosConflict('CAB-AER-SM-13.1-288F', 'SPLIT-BF-1-16')).toBe(false);
  });
});

describe('ratiosConflict', () => {
  it('conflicts only when both sides state a ratio and they differ', () => {
    expect(ratiosConflict('1:16 Splitter', 'SPLIT-BF-1-2')).toBe(true);
    expect(ratiosConflict('1:16 Splitter', 'SPLIT-BF-1-16')).toBe(false);
  });

  it('treats silence as agreement', () => {
    // A veto on missing information would reject far more than it should.
    expect(ratiosConflict('1:16 Splitter', 'Cable Clip')).toBe(false);
    expect(ratiosConflict('Cable Clip', 'SPLIT-BF-1-2')).toBe(false);
  });
});

describe('stock matching', () => {
  it('picks the identically-named item rather than a shorter near-name', async () => {
    const result = await match('1:16 Bare Fibre Splitter');

    expect(result.stockItem?.itemCode).toBe('SPLIT-BF-1-16');
    // Distinct from 'exact_code': the NAME matched, not the item code.
    expect(result.matchMethod).toBe('exact_name');
    expect(result.matchConfidence).toBe(1);
  });

  it('refuses a candidate whose split ratio contradicts the line', async () => {
    // Only the wrong-ratio splitters exist, so fuzzy could otherwise pick one.
    rows.stockItems = SPLITTERS.filter(s => s.item_code !== 'SPLIT-BF-1-16');

    const result = await match('1:16 Bare Fibre Splitter');

    expect(result.stockItem).toBeNull();
    expect(result.matchMethod).toBe('none');
  });

  it('still matches when only one side states a ratio', async () => {
    rows.stockItems = [
      { id: 'clip', item_code: 'CABLECLIP', name: '3mm Cable Clips', description: '', category: 'consumables' },
    ];

    const result = await match('3mm Cable Clips');

    expect(result.stockItem?.itemCode).toBe('CABLECLIP');
  });

  it('will not choose between two stock items sharing a name', async () => {
    // A duplicated name is a catalogue problem; guessing receives the wrong one.
    rows.stockItems = [
      { id: 'a', item_code: 'DUP-A', name: 'Duplicated Name', description: '', category: 'x' },
      { id: 'b', item_code: 'DUP-B', name: 'Duplicated Name', description: '', category: 'x' },
    ];

    const result = await match('Duplicated Name');

    expect(result.matchMethod).not.toBe('exact_name');
  });

  it('keeps matching an exact item code, which outranks the name', async () => {
    const result = await match('something else entirely', 'SPLIT-BF-1-8');

    expect(result.stockItem?.itemCode).toBe('SPLIT-BF-1-8');
    expect(result.matchMethod).toBe('exact_code');
  });
});
