/**
 * fetchOneMapRecord tri-state behavior — availability failures (5xx / timeout)
 * must NOT masquerade as "not in 1Map"; they fall back to the local
 * onemap_properties mirror and set lookupFailed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: { query: (...args: unknown[]) => queryMock(...args) },
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

import { fetchOneMapRecord } from '@/modules/activate/services/ack/drLookupService';

const bossResponse = (status: number, body?: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const realFetch = global.fetch;

describe('fetchOneMapRecord', () => {
  // Braces matter: `() => queryMock.mockReset()` implicitly returns the mock,
  // and vitest CALLS a function returned from a hook as teardown — invoking
  // the mock with whatever implementation the test installed (a throwing one
  // detonates as an unhandled error attributed to the test).
  beforeEach(() => { queryMock.mockReset(); });
  afterEach(() => { global.fetch = realFetch; });

  it('maps a BOSS 200 to found with extracted serial', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(bossResponse(200, { photo_count: 3, ont_barcode: '(S)ALCLB477AAAA(23S)x', ups_serial: 'UPS1' }))
    ) as typeof fetch;

    const r = await fetchOneMapRecord('DR1');
    expect(r).toMatchObject({ found: true, photoCount: 3, ontSerial: 'ALCLB477AAAA', upsSerial: 'UPS1' });
    expect(r.lookupFailed).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('treats BOSS 404 as genuine not-found (no mirror consult, no lookupFailed)', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(bossResponse(404))) as typeof fetch;

    const r = await fetchOneMapRecord('DR2');
    expect(r.found).toBe(false);
    expect(r.lookupFailed).toBeUndefined();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('falls back to the mirror on BOSS 500 — mirror hit', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve(bossResponse(500))) as typeof fetch;
    queryMock.mockImplementation(() => Promise.resolve({ rowCount: 1, rows: [{ '?column?': 1 }] }));

    const r = await fetchOneMapRecord('DR3');
    expect(r).toMatchObject({ found: false, lookupFailed: true, mirrorFound: true });
    expect(queryMock).toHaveBeenCalledOnce();
  });

  it('falls back to the mirror on network failure — mirror miss', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    queryMock.mockImplementation(() => Promise.resolve({ rowCount: 0, rows: [] }));

    const r = await fetchOneMapRecord('DR4');
    expect(r).toMatchObject({ found: false, lookupFailed: true, mirrorFound: false });
  });

  it('still sets lookupFailed when the mirror query itself fails', async () => {
    global.fetch = vi.fn().mockImplementation(() => Promise.reject(new Error('timeout'))) as typeof fetch;
    queryMock.mockImplementation(() => { throw new Error('db down'); });

    const r = await fetchOneMapRecord('DR5');
    expect(r.found).toBe(false);
    expect(r.lookupFailed).toBe(true);
    expect(r.mirrorFound).toBeUndefined();
  });
});
