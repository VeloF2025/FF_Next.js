/**
 * Unit tests for the Tier 3.2 auto-block helpers in holderBlockGuard (SOP-4.4).
 *
 * DB is replaced with a routing Querier stub (matches on SQL substrings), so these
 * verify the SQL-shaping + control flow without a Postgres container. The live SQL
 * is additionally covered by the migration (411) and the view (mig 410) being
 * applied to the shared DB.
 */
import { describe, it, expect, vi } from 'vitest';
import type { TxnClient } from '@/lib/db-pool';
import {
  type Querier,
  loadAutoBlockPolicy,
  getHolderAgedMetrics,
  autoBlockHolder,
  assertHolderAutoBlock,
  commitAutoBlockRefusal,
  HolderAutoBlockedError,
} from '../holderBlockGuard';

const HOLDER = 'b1000000-0000-0000-0000-000000000099';

/** Build a Querier that routes canned rows by SQL substring. */
function makeQuerier(routes: {
  policy?: Record<string, unknown>[];
  metrics?: Record<string, unknown>[];
  insert?: Record<string, unknown>[];
}): { q: Querier; calls: { text: string; params?: unknown[] }[] } {
  const calls: { text: string; params?: unknown[] }[] = [];
  const q = (async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    if (text.includes('stock_accountability_config')) return routes.policy ?? [];
    if (text.includes('v_holder_stock_exceptions')) return routes.metrics ?? [];
    if (text.includes('INSERT INTO stock_accountability')) return routes.insert ?? [];
    return [];
  }) as Querier;
  return { q, calls };
}

/** Wrap a Querier as a TxnClient (only .query is used by assertHolderAutoBlock). */
function asTxn(q: Querier): TxnClient {
  return { query: q, queryOne: vi.fn(), client: {} as never } as unknown as TxnClient;
}

describe('loadAutoBlockPolicy', () => {
  it('maps a config row, coercing numeric strings', async () => {
    const { q } = makeQuerier({
      policy: [{ auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: '5000.00' }],
    });
    const policy = await loadAutoBlockPolicy(q);
    expect(policy).toEqual({ enabled: true, agedCountThreshold: 3, agedValueThreshold: 5000 });
  });

  it('falls back to the disabled default when no row exists', async () => {
    const { q } = makeQuerier({ policy: [] });
    const policy = await loadAutoBlockPolicy(q);
    expect(policy.enabled).toBe(false);
  });

  it('falls back to disabled on 42P01 (config table not yet migrated) — never 500s the issue path', async () => {
    const q = (async () => {
      throw Object.assign(new Error('relation "stock_accountability_config" does not exist'), {
        code: '42P01',
      });
    }) as Querier;
    await expect(loadAutoBlockPolicy(q)).resolves.toEqual(
      expect.objectContaining({ enabled: false }),
    );
  });

  it('re-throws non-42P01 errors (real failures must surface)', async () => {
    const q = (async () => {
      throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    }) as Querier;
    await expect(loadAutoBlockPolicy(q)).rejects.toThrow('connection refused');
  });
});

describe('getHolderAgedMetrics', () => {
  it('coerces aged_count/aged_value (pg returns numeric as string)', async () => {
    const { q, calls } = makeQuerier({ metrics: [{ aged_count: '4', aged_value: '5200.50' }] });
    const metrics = await getHolderAgedMetrics(q, HOLDER);
    expect(metrics).toEqual({ agedCount: 4, agedValue: 5200.5 });
    expect(calls[0].params).toEqual([HOLDER]);
  });

  it('returns zeros when the holder has no exception rows', async () => {
    const { q } = makeQuerier({ metrics: [] });
    expect(await getHolderAgedMetrics(q, HOLDER)).toEqual({ agedCount: 0, agedValue: 0 });
  });
});

describe('autoBlockHolder', () => {
  it('returns true when the upsert flipped the holder to blocked (RETURNING a row)', async () => {
    const { q, calls } = makeQuerier({ insert: [{ holder_id: HOLDER }] });
    const blocked = await autoBlockHolder(q, HOLDER, 'reason', 'auto-block:sweep');
    expect(blocked).toBe(true);
    expect(calls[0].text).toContain('ON CONFLICT (holder_id) DO UPDATE');
    expect(calls[0].text).toContain('WHERE stock_accountability.is_blocked = false');
    expect(calls[0].params).toEqual([HOLDER, 'reason', 'auto-block:sweep']);
  });

  it('returns false when already blocked (no RETURNING row — idempotent no-op)', async () => {
    const { q } = makeQuerier({ insert: [] });
    expect(await autoBlockHolder(q, HOLDER, 'reason', 'auto-block:sweep')).toBe(false);
  });
});

describe('assertHolderAutoBlock', () => {
  it('is a no-op when the policy is disabled (never reads metrics)', async () => {
    const { q, calls } = makeQuerier({
      policy: [{ auto_block_enabled: false, aged_count_threshold: 3, aged_value_threshold: 5000 }],
    });
    await expect(assertHolderAutoBlock(asTxn(q), HOLDER)).resolves.toBeUndefined();
    // Only the policy load ran — no exceptions query.
    expect(calls.some((c) => c.text.includes('v_holder_stock_exceptions'))).toBe(false);
  });

  it('is a no-op when enabled but under threshold', async () => {
    const { q } = makeQuerier({
      policy: [{ auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: 5000 }],
      metrics: [{ aged_count: '2', aged_value: '100' }],
    });
    await expect(assertHolderAutoBlock(asTxn(q), HOLDER)).resolves.toBeUndefined();
  });

  it('throws HolderAutoBlockedError (carrying reason + metrics) when over threshold; writes nothing', async () => {
    const { q, calls } = makeQuerier({
      policy: [{ auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: 5000 }],
      metrics: [{ aged_count: '4', aged_value: '5200' }],
    });
    await expect(assertHolderAutoBlock(asTxn(q), HOLDER)).rejects.toMatchObject({
      name: 'HolderAutoBlockedError',
      holderId: HOLDER,
      metrics: { agedCount: 4, agedValue: 5200 },
    });
    // Critical: the guard must NOT write the block inside the txn (it would roll back).
    expect(calls.some((c) => c.text.includes('INSERT INTO stock_accountability'))).toBe(false);
  });

  it('error reason explains the trip', async () => {
    const { q } = makeQuerier({
      policy: [{ auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: 5000 }],
      metrics: [{ aged_count: '4', aged_value: '5200' }],
    });
    // rejects.toMatchObject (not a .catch callback) so the assertion is not
    // silently skipped if the function ever stops throwing.
    await expect(assertHolderAutoBlock(asTxn(q), HOLDER)).rejects.toMatchObject({
      blockedReason: expect.stringContaining('Auto-blocked (SOP-4.4)'),
    });
  });

  it('is a no-op for a holder with all-zero metrics under an enabled policy (the common case)', async () => {
    const { q, calls } = makeQuerier({
      policy: [{ auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: 5000 }],
      metrics: [{ aged_count: '0', aged_value: '0' }],
    });
    await expect(assertHolderAutoBlock(asTxn(q), HOLDER)).resolves.toBeUndefined();
    expect(calls.some((c) => c.text.includes('INSERT INTO stock_accountability'))).toBe(false);
  });
});

describe('commitAutoBlockRefusal (issue-path catch helper)', () => {
  const ERR = new HolderAutoBlockedError(HOLDER, 'Auto-blocked (SOP-4.4): test', {
    agedCount: 4,
    agedValue: 5200,
  });

  it('commits the block via the pool and returns the 409 payload', async () => {
    const { q, calls } = makeQuerier({ insert: [{ holder_id: HOLDER }] });
    const payload = await commitAutoBlockRefusal(q, ERR);
    expect(payload).toEqual({
      holderId: HOLDER,
      blockedReason: 'Auto-blocked (SOP-4.4): test',
      autoBlocked: true,
    });
    expect(calls[0].text).toContain('INSERT INTO stock_accountability');
    expect(calls[0].params).toEqual([HOLDER, 'Auto-blocked (SOP-4.4): test', 'auto-block:issue-guard']);
  });

  it('still returns the 409 payload when the block write throws (failure is swallowed + logged)', async () => {
    const q = (async () => {
      throw new Error('write failed');
    }) as Querier;
    const payload = await commitAutoBlockRefusal(q, ERR);
    expect(payload).toEqual({
      holderId: HOLDER,
      blockedReason: 'Auto-blocked (SOP-4.4): test',
      autoBlocked: true,
    });
  });
});
