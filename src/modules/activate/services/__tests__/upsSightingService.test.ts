/**
 * upsSightingService.test.ts
 * Verifies the non-authoritative UPS photo-sighting recorder: it only writes a
 * lifecycle event for a confident read that maps to a known stock unit, and is
 * driven by the uq_sse_dedupe index for idempotency (INSERT returning no row).
 */
import { describe, it, expect, vi } from 'vitest';
import { recordUpsPhotoSighting } from '../upsSightingService';

type QueryCall = { text: string; params: unknown[] };

/**
 * Minimal fake pg client that routes by SQL text:
 *   stockMatch  → row for the stock_serials lookup (null = no unit)
 *   reviewId    → row for the dr_photo_unified_reviews lookup (null = none)
 *   insertRow   → row returned by the stock_serial_events INSERT (null = dedupe no-op)
 */
function makeDb(opts: { stockMatch?: string | null; reviewId?: string | null; insertRow?: boolean }) {
  const calls: QueryCall[] = [];
  const query = vi.fn(async (text: string, params: unknown[]) => {
    calls.push({ text, params });
    if (/FROM stock_serials/.test(text)) {
      return { rows: opts.stockMatch ? [{ id: opts.stockMatch }] : [] };
    }
    if (/FROM dr_photo_unified_reviews/.test(text)) {
      return { rows: opts.reviewId ? [{ id: opts.reviewId }] : [] };
    }
    if (/INSERT INTO stock_serial_events/.test(text)) {
      return { rows: opts.insertRow ? [{ id: 'evt-1', serial_id: opts.stockMatch, event_type: 'wa_photo_sighting', payload: {}, occurred_at: new Date(), recorded_at: new Date() }] : [] };
    }
    return { rows: [] };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { db: { query } as any, calls, query };
}

const args = (over: Partial<{ dropNumber: string; upsSerial: string | null; confidence: number }> = {}) => ({
  dropNumber: 'DR123', upsSerial: 'GU18W12V2509031056', confidence: 0.97, ...over,
});

describe('recordUpsPhotoSighting', () => {
  it('skips a sub-threshold confidence read (no INSERT)', async () => {
    const { db, query } = makeDb({ stockMatch: 'unit-1', reviewId: 'rev-1', insertRow: true });
    expect(await recordUpsPhotoSighting(db, args({ confidence: 0.94 }))).toBe('skipped');
    expect(query).not.toHaveBeenCalled();
  });

  it('skips a null/empty serial', async () => {
    const { db, query } = makeDb({});
    expect(await recordUpsPhotoSighting(db, args({ upsSerial: null }))).toBe('skipped');
    expect(query).not.toHaveBeenCalled();
  });

  it('skips when the serial matches no stock unit (likely wrong photo)', async () => {
    const { db, calls } = makeDb({ stockMatch: null });
    expect(await recordUpsPhotoSighting(db, args())).toBe('skipped');
    expect(calls.some((c) => /INSERT INTO stock_serial_events/.test(c.text))).toBe(false);
  });

  it('skips when no DR review row exists (cannot key idempotency)', async () => {
    const { db, calls } = makeDb({ stockMatch: 'unit-1', reviewId: null });
    expect(await recordUpsPhotoSighting(db, args())).toBe('skipped');
    expect(calls.some((c) => /INSERT INTO stock_serial_events/.test(c.text))).toBe(false);
  });

  it('records a wa_photo_sighting keyed on the review uuid when confident + matched', async () => {
    const { db, calls } = makeDb({ stockMatch: 'unit-1', reviewId: 'rev-1', insertRow: true });
    expect(await recordUpsPhotoSighting(db, args())).toBe('recorded');
    const insert = calls.find((c) => /INSERT INTO stock_serial_events/.test(c.text));
    expect(insert).toBeDefined();
    // event_type, source_table, source_id (the review uuid) are passed as params
    expect(insert!.params).toContain('wa_photo_sighting');
    expect(insert!.params).toContain('dr_photo_unified_reviews');
    expect(insert!.params).toContain('rev-1');
  });

  it('reports a duplicate when the dedupe index makes the INSERT a no-op', async () => {
    const { db } = makeDb({ stockMatch: 'unit-1', reviewId: 'rev-1', insertRow: false });
    expect(await recordUpsPhotoSighting(db, args())).toBe('duplicate');
  });

  it('never throws — a DB error is swallowed and returns skipped', async () => {
    const db = { query: vi.fn(async () => { throw new Error('db down'); }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await recordUpsPhotoSighting(db as any, args())).toBe('skipped');
  });
});
