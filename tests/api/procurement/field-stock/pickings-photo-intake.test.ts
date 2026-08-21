/**
 * validateSerialsAvailable — the SERVER decision to take a single unlisted
 * unit into stock on the evidence of a label photograph.
 *
 * This path had no tests. Everything else about the feature was covered on the
 * client — the request body, the pure verdict rule, the camera affordance —
 * and none of it touches the code that actually writes the row. If photoFor
 * matched the wrong field, if the SQL swapped photoKey and photoUrl, or if the
 * `|| photo` branch were dropped, every one of those tests stayed green.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { validateSerialsAvailable, type PickingLine } from '@/../pages/api/procurement/field-stock/pickings/_validation';

/** Statements issued, whitespace-collapsed, for whole-run assertions. */
const statements = () =>
  mockSql.mock.calls.map((c) => (Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])).replace(/\s+/g, ' '));
/** Parameters of the INSERT that creates a field-intake serial. */
const insertParams = () => {
  const i = mockSql.mock.calls.findIndex(
    (c) => /INSERT INTO stock_serials/i.test(Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])),
  );
  return i === -1 ? null : mockSql.mock.calls[i]!.slice(1);
};

const GIZZU = 'GU18W12V2601016741';
const GIZZU_2 = 'GU18W12V2601016745';
const ITEM = 'item-gizzu';
const LOC = 'loc-tembisa-1';

/** No serial resolves; the INSERT returns a new id. */
function noneInStock() {
  mockSql.mockImplementation(async (strings: unknown) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (/INSERT INTO stock_serials/i.test(text)) return [{ id: 'created-1' }];
    return [];
  });
}

const line = (over: Partial<PickingLine> = {}): PickingLine => ({
  stockItemId: ITEM, plannedQuantity: 1, serialIds: [GIZZU], ...over,
});
const run = (lines: PickingLine[]) =>
  validateSerialsAvailable(mockSql as never, lines, { sourceLocationId: LOC, actorStaffId: 'stores-1' });

beforeEach(() => { vi.clearAllMocks(); noneInStock(); });

describe('a photograph admits a single unlisted unit', () => {
  it('creates the serial and resolves it to the new id', async () => {
    const result = await run([line({
      intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1', photoUrl: 'u1' }],
    })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resolvedSerialIds!.get(GIZZU)).toBe('created-1');
  });

  it('stores the photo key and url in the RIGHT COLUMNS', async () => {
    // Positional, not merely present. Asserting both values appear somewhere
    // passes just as happily when they are swapped — which would store a URL
    // as the key, break the unique index's meaning, and never be noticed by
    // any client-side test.
    await run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1', photoUrl: 'u1' }] })]);
    expect(insertParams()).toEqual([ITEM, GIZZU, LOC, null, 'stores-1', 'k1', 'u1']);
    const sql = statements().find((s) => /INSERT INTO stock_serials/i.test(s))!;
    expect(sql).toMatch(/intake_photo_key, intake_photo_url/);
  });

  it('leaves the url null when only a key was captured', async () => {
    await run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1' }] })]);
    expect(insertParams()).toEqual([ITEM, GIZZU, LOC, null, 'stores-1', 'k1', null]);
  });

  it('marks it field_intake, in_stock, at the issuing warehouse', async () => {
    await run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1' }] })]);
    const params = insertParams()!;
    expect(params).toContain(LOC);
    const provenance = statements().find((s) => /INSERT INTO stock_serials/i.test(s))!;
    // A literal in the statement, not a parameter.
    expect(provenance).toMatch(/'field_intake'/);
    // NOT 'issued': a trigger refuses issued-without-holder, and the picking's
    // process step is what assigns the holder.
    const sql = statements().find((s) => /INSERT INTO stock_serials/i.test(s))!;
    expect(sql).toMatch(/'in_stock'/);
  });

  it('REFUSES the same serial with no photo and no carton', async () => {
    const result = await run([line()]);
    expect(result.ok).toBe(false);
    expect(statements().some((s) => /INSERT INTO stock_serials/i.test(s))).toBe(false);
  });
});

describe('one photo, one unit', () => {
  it('refuses BOTH serials when one key is offered for two', async () => {
    // A single picture standing for two units is not evidence. Refusing both
    // rather than the later one keeps the outcome independent of array order.
    const result = await run([line({
      serialIds: [GIZZU, GIZZU_2],
      intakePhotos: [
        { serialNumber: GIZZU, photoKey: 'same' },
        { serialNumber: GIZZU_2, photoKey: 'same' },
      ],
    })]);
    expect(result.ok).toBe(false);
    expect(statements().some((s) => /INSERT INTO stock_serials/i.test(s))).toBe(false);
  });

  it('admits both when each has its own photo', async () => {
    const result = await run([line({
      serialIds: [GIZZU, GIZZU_2],
      intakePhotos: [
        { serialNumber: GIZZU, photoKey: 'k1' },
        { serialNumber: GIZZU_2, photoKey: 'k2' },
      ],
    })]);
    expect(result.ok).toBe(true);
  });

  it('does not let a photo for one serial admit another', async () => {
    const result = await run([line({
      serialIds: [GIZZU_2],
      intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1' }],
    })]);
    expect(result.ok).toBe(false);
  });

  it('ignores a blank or whitespace-only key', async () => {
    for (const photoKey of ['', '   ']) {
      vi.clearAllMocks(); noneInStock();
      const result = await run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey }] })]);
      expect(result.ok, `key ${JSON.stringify(photoKey)} must not admit`).toBe(false);
    }
  });
});

describe('the rough edges that would have reached a storeman as a 500', () => {
  it('refuses a key reused across TWO LINES of the same request', async () => {
    // Two lines are the same submission by the same person at the same moment.
    // Counting only within a line would leave this to the unique index, which
    // surfaces as a raw database error rather than a refusal naming the serial.
    const OTHER_ITEM = '11111111-2222-4333-8444-555555555555';
    const result = await run([
      line({ serialIds: [GIZZU], intakePhotos: [{ serialNumber: GIZZU, photoKey: 'same' }] }),
      line({
        stockItemId: OTHER_ITEM,
        serialIds: [GIZZU_2],
        intakePhotos: [{ serialNumber: GIZZU_2, photoKey: 'same' }],
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(statements().some((s) => /INSERT INTO stock_serials/i.test(s))).toBe(false);
  });

  it('still admits both when the two lines use different keys', async () => {
    const OTHER_ITEM = '11111111-2222-4333-8444-555555555555';
    const result = await run([
      line({ serialIds: [GIZZU], intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1' }] }),
      line({
        stockItemId: OTHER_ITEM,
        serialIds: [GIZZU_2],
        intakePhotos: [{ serialNumber: GIZZU_2, photoKey: 'k2' }],
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('turns a key already used in an EARLIER request into a refusal, not a crash', async () => {
    // The unique index from migration 520 fires on the INSERT. Uncaught, it
    // reaches the storeman as a generic 500 instead of naming the serial.
    mockSql.mockImplementation(async (strings: unknown) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/INSERT INTO stock_serials/i.test(text)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      return [];
    });
    const result = await run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey: 'used' }] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('does NOT swallow an unrelated database error', async () => {
    mockSql.mockImplementation(async (strings: unknown) => {
      const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
      if (/INSERT INTO stock_serials/i.test(text)) {
        throw Object.assign(new Error('relation missing'), { code: '42P01' });
      }
      return [];
    });
    await expect(
      run([line({ intakePhotos: [{ serialNumber: GIZZU, photoKey: 'k1' }] })]),
    ).rejects.toThrow('relation missing');
  });
});

