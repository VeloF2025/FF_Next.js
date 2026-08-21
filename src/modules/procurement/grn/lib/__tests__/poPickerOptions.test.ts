/**
 * Fixtures mirror real rows read from the production DB on 2026-08-21.
 *
 * PO-2026-0237 is the order from the incident: 7500 ordered, 800 received
 * across one GRN, 6700 outstanding — the one that sorted to position 347 of 621
 * and looked deleted to the user.
 */
import { describe, it, expect } from 'vitest';
import {
  poOutstanding,
  poReceiptState,
  isPoSelectable,
  poSortRank,
  poMatchesQuery,
  filterAndRankPos,
  poStateBadge,
  buildPickerRows,
  type PickerPurchaseOrder,
} from '../poPickerOptions';

const po = (over: Partial<PickerPurchaseOrder> = {}): PickerPurchaseOrder => ({
  id: 'id-1',
  poNumber: 'PO-2026-0001',
  status: 'approved',
  supplierName: 'Global Optic Cable SA',
  itemCount: 5,
  grnCount: 0,
  totalOrdered: 100,
  totalReceived: 0,
  ...over,
});

// Real production rows.
const PART_RECEIVED = po({
  id: 'p237', poNumber: 'PO-2026-0237', status: 'partially_received',
  supplierName: 'CABLE FEEDER SYSTEMS AFRICA CC',
  itemCount: 5, grnCount: 1, totalOrdered: 7500, totalReceived: 800,
});
const FULLY_RECEIVED = po({
  id: 'p235', poNumber: 'PO-2026-0235', status: 'received',
  itemCount: 1, grnCount: 1, totalOrdered: 5000, totalReceived: 5000,
});
const UNTOUCHED = po({
  id: 'p239', poNumber: 'PO-2026-0239', status: 'approved',
  supplierName: 'CABLE FEEDER SYSTEMS AFRICA CC',
  itemCount: 5, grnCount: 0, totalOrdered: 15000, totalReceived: 0,
});

describe('poOutstanding', () => {
  it('is the real 6700 for the incident PO, not a rounded or zeroed value', () => {
    expect(poOutstanding(PART_RECEIVED)).toBe(6700);
  });

  it('clamps an over-receipt to 0 rather than returning a negative', () => {
    expect(poOutstanding(po({ grnCount: 1, totalOrdered: 100, totalReceived: 130 }))).toBe(0);
  });
});

describe('poReceiptState', () => {
  it('classifies the incident PO as partially received', () => {
    expect(poReceiptState(PART_RECEIVED)).toBe('partially_received');
  });

  it('classifies a completed PO as fully received', () => {
    expect(poReceiptState(FULLY_RECEIVED)).toBe('fully_received');
  });

  it('classifies an untouched PO as not received', () => {
    expect(poReceiptState(UNTOUCHED)).toBe('not_received');
  });

  it('treats an over-receipt as fully received, not partially', () => {
    expect(poReceiptState(po({ grnCount: 1, totalOrdered: 100, totalReceived: 130 }))).toBe('fully_received');
  });

  it('derives state from quantities, ignoring a status column that disagrees', () => {
    // status says received; the quantities say 6700 are still outstanding.
    const lying = po({ ...PART_RECEIVED, status: 'received' });
    expect(poReceiptState(lying)).toBe('partially_received');
  });

  it('stays partially_received when a GRN exists but every line was entered as 0', () => {
    // Exactly what Lizelle asked about: entering 0 does not complete the PO.
    expect(poReceiptState(po({ grnCount: 1, totalOrdered: 500, totalReceived: 0 }))).toBe('partially_received');
  });
});

describe('isPoSelectable', () => {
  it('allows the incident PO to be chosen again for the remaining 6700', () => {
    expect(isPoSelectable(PART_RECEIVED)).toBe(true);
  });

  it('blocks a fully-received PO', () => {
    expect(isPoSelectable(FULLY_RECEIVED)).toBe(false);
  });

  it('allows an untouched PO', () => {
    expect(isPoSelectable(UNTOUCHED)).toBe(true);
  });
});

describe('poSortRank', () => {
  it('ranks part-received ABOVE untouched — the regression that caused the incident', () => {
    expect(poSortRank(PART_RECEIVED)).toBeLessThan(poSortRank(UNTOUCHED));
  });

  it('ranks fully-received last', () => {
    expect(poSortRank(FULLY_RECEIVED)).toBeGreaterThan(poSortRank(UNTOUCHED));
  });
});

describe('poMatchesQuery', () => {
  it('matches on a PO-number fragment', () => {
    expect(poMatchesQuery(PART_RECEIVED, '0237')).toBe(true);
  });

  it('matches on supplier name regardless of case', () => {
    expect(poMatchesQuery(PART_RECEIVED, 'cable feeder')).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    expect(poMatchesQuery(PART_RECEIVED, '  0237  ')).toBe(true);
  });

  it('rejects a non-match', () => {
    expect(poMatchesQuery(PART_RECEIVED, 'Misho')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(poMatchesQuery(PART_RECEIVED, '')).toBe(true);
  });
});

describe('filterAndRankPos', () => {
  it('surfaces the part-received PO first even when it is last in the input', () => {
    const ranked = filterAndRankPos([UNTOUCHED, FULLY_RECEIVED, PART_RECEIVED], '');
    expect(ranked.map((p) => p.poNumber)).toEqual(['PO-2026-0237', 'PO-2026-0239', 'PO-2026-0235']);
  });

  it('reproduces the incident: 339 untouched POs no longer bury the part-received one', () => {
    const many = Array.from({ length: 339 }, (_, i) =>
      po({ id: `bulk-${i}`, poNumber: `PO-2026-${String(i).padStart(4, '0')}`, grnCount: 0 })
    );
    const ranked = filterAndRankPos([...many, PART_RECEIVED], '');
    expect(ranked[0]?.poNumber).toBe('PO-2026-0237');
  });

  it('narrows 621 entries to the one the user typed', () => {
    // Numbered from 3000 so no generated PO number can contain the substring
    // "0237" — a naive 0-padded range mints PO-2025-0237 and the search
    // correctly returns two, which would make this assertion test the fixture.
    const many = Array.from({ length: 620 }, (_, i) =>
      po({ id: `bulk-${i}`, poNumber: `PO-2025-${3000 + i}` })
    );
    const ranked = filterAndRankPos([...many, PART_RECEIVED], '0237');
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.poNumber).toBe('PO-2026-0237');
  });

  it('keeps the server order within a rank group (most recent first)', () => {
    const a = po({ id: 'a', poNumber: 'PO-A' });
    const b = po({ id: 'b', poNumber: 'PO-B' });
    const c = po({ id: 'c', poNumber: 'PO-C' });
    expect(filterAndRankPos([a, b, c], '').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the caller’s array', () => {
    const input = [UNTOUCHED, PART_RECEIVED];
    filterAndRankPos(input, '');
    expect(input.map((p) => p.id)).toEqual(['p239', 'p237']);
  });
});

describe('poStateBadge', () => {
  it('shows the outstanding quantity for the incident PO', () => {
    expect(poStateBadge(PART_RECEIVED)).toBe('6700 outstanding');
  });

  it('marks a completed PO', () => {
    expect(poStateBadge(FULLY_RECEIVED)).toBe('Fully received');
  });

  it('shows nothing for an untouched PO', () => {
    expect(poStateBadge(UNTOUCHED)).toBeNull();
  });
});

describe('buildPickerRows', () => {
  it('puts the standalone-receipt row first so the keyboard can reach it', () => {
    const rows = buildPickerRows([PART_RECEIVED]);
    expect(rows[0]).toEqual({ poId: '', po: null, selectable: true });
  });

  it('marks a fully-received PO unselectable but still includes it as a row', () => {
    const rows = buildPickerRows([FULLY_RECEIVED]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.selectable).toBe(false);
    expect(rows[1]?.poId).toBe('p235');
  });

  it('marks a part-received PO selectable', () => {
    expect(buildPickerRows([PART_RECEIVED])[1]?.selectable).toBe(true);
  });

  it('returns just the standalone row for an empty list', () => {
    expect(buildPickerRows([])).toHaveLength(1);
  });
});
