import { describe, it, expect, vi } from 'vitest';
import { populateTypedSerials, type QueryableDb } from '../typedSerialPopulator';

/**
 * Fake QueryableDb: the first SELECT returns `selectRows`, every UPDATE records its
 * params, and the trailing COUNT returns `remaining`. Lets us assert the populator's
 * write decisions without a database.
 */
function makeDb(selectRows: Array<{ id: string; wa_original_text: string }>, remaining = 0) {
  const updates: Array<{ ont: unknown; ups: unknown; id: unknown }> = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    if (text.includes('UPDATE dr_photo_unified_reviews')) {
      updates.push({ ont: params?.[0], ups: params?.[1], id: params?.[2] });
      return { rows: [] };
    }
    if (text.includes('COUNT(*)')) {
      return { rows: [{ remaining: String(remaining) }] };
    }
    // the SELECT of unprocessed rows
    return { rows: selectRows };
  });
  // Single cast of the whole fake rather than per-return `as never[]`.
  const db = { query } as unknown as QueryableDb;
  return { db, updates, query };
}

describe('populateTypedSerials', () => {
  it('writes the parsed ONT serial and marks the row extracted', async () => {
    const { db, updates } = makeDb([
      { id: 'a', wa_original_text: 'DR1747382 S/N:ALCLB48E394B 5245 Simelane street' },
    ]);
    const result = await populateTypedSerials(100, db);

    expect(updates).toEqual([{ ont: 'ALCLB48E394B', ups: null, id: 'a' }]);
    expect(result).toMatchObject({ processed: 1, ontFound: 1, upsFound: 0 });
  });

  it('still marks a row extracted when no serial is found (NULL serials)', async () => {
    const { db, updates } = makeDb([
      { id: 'b', wa_original_text: 'DR1747382 customer not home please reschedule' },
    ]);
    const result = await populateTypedSerials(100, db);

    expect(updates).toEqual([{ ont: null, ups: null, id: 'b' }]);
    expect(result).toMatchObject({ processed: 1, ontFound: 0, upsFound: 0 });
  });

  it('writes both ONT and UPS when both are typed', async () => {
    const { db, updates } = makeDb([
      { id: 'c', wa_original_text: 'DR1 ONT ALCLB477AED3 UPS GU18W12V2500164' },
    ]);
    const result = await populateTypedSerials(100, db);

    expect(updates[0]).toEqual({ ont: 'ALCLB477AED3', ups: 'GU18W12V2500164', id: 'c' });
    expect(result).toMatchObject({ ontFound: 1, upsFound: 1 });
  });

  it('processes every selected row and reports the remaining backlog', async () => {
    const { db } = makeDb(
      [
        { id: '1', wa_original_text: 'ALCLB477AED3' },
        { id: '2', wa_original_text: 'no serial here' },
        { id: '3', wa_original_text: 'ALCB47D5A8F' },
      ],
      7
    );
    const result = await populateTypedSerials(100, db);
    expect(result).toEqual({ processed: 3, ontFound: 2, upsFound: 0, remaining: 7 });
  });

  it('binds a clamped LIMIT to the unprocessed-rows SELECT', async () => {
    const { db, query } = makeDb([]);
    await populateTypedSerials(999999, db);
    const calls = query.mock.calls;
    const select = calls.find((c) => String(c[0]).includes('wa_typed_serial_extracted_at IS NULL') && String(c[0]).includes('LIMIT'));
    expect(select?.[1]).toEqual([50000]); // MAX_LIMIT cap
  });

  it('does no UPDATE when there are no unprocessed rows', async () => {
    const { db, updates } = makeDb([]);
    const result = await populateTypedSerials(100, db);
    expect(updates).toHaveLength(0);
    expect(result).toMatchObject({ processed: 0, ontFound: 0, upsFound: 0 });
  });
});
