/**
 * Unit tests for runAutoBlockSweep (Tier 3.2 / SOP-4.4) with a routing Querier
 * stub. Verifies disabled short-circuit, per-holder threshold application, and the
 * blocked / alreadyBlocked accounting.
 */
import { describe, it, expect } from 'vitest';
import type { Querier } from '../holderBlockGuard';
import { runAutoBlockSweep } from '../autoBlockSweep';

const H1 = 'b1000000-0000-0000-0000-000000000001';
const H2 = 'b1000000-0000-0000-0000-000000000002';
const H3 = 'b1000000-0000-0000-0000-000000000003';

interface Routes {
  policy?: Record<string, unknown>[];
  sweep?: Record<string, unknown>[];
  /** holderIds the upsert should report as newly-blocked (RETURNING a row). */
  newlyBlocked?: Set<string>;
  /** holderIds whose upsert should throw (simulate a write failure). */
  throwOn?: Set<string>;
}

function makeQuerier(routes: Routes): { q: Querier; inserts: string[] } {
  const inserts: string[] = [];
  const q = (async (text: string, params?: unknown[]) => {
    if (text.includes('stock_accountability_config')) return routes.policy ?? [];
    if (text.includes('INSERT INTO stock_accountability')) {
      const holderId = (params?.[0] as string) ?? '';
      inserts.push(holderId);
      if (routes.throwOn?.has(holderId)) throw new Error(`write failed for ${holderId}`);
      return routes.newlyBlocked?.has(holderId) ? [{ holder_id: holderId }] : [];
    }
    // The grouped sweep SELECT over the exceptions view.
    if (text.includes('v_holder_stock_exceptions')) return routes.sweep ?? [];
    return [];
  }) as Querier;
  return { q, inserts };
}

const ENABLED_POLICY = [
  { auto_block_enabled: true, aged_count_threshold: 3, aged_value_threshold: 5000 },
];

describe('runAutoBlockSweep', () => {
  it('short-circuits (writes nothing) when the policy is disabled', async () => {
    const { q, inserts } = makeQuerier({
      policy: [{ auto_block_enabled: false, aged_count_threshold: 3, aged_value_threshold: 5000 }],
      sweep: [{ holder_id: H1, aged_count: '9', aged_value: '99999' }],
    });
    const result = await runAutoBlockSweep(q);
    expect(result).toEqual({ enabled: false, evaluated: 0, blocked: [], alreadyBlocked: 0, errors: [] });
    expect(inserts).toHaveLength(0);
  });

  it('blocks only holders over threshold; leaves under-threshold holders alone', async () => {
    const { q, inserts } = makeQuerier({
      policy: ENABLED_POLICY,
      sweep: [
        { holder_id: H1, aged_count: '4', aged_value: '100' },   // over (count)
        { holder_id: H2, aged_count: '1', aged_value: '6000' },  // over (value)
        { holder_id: H3, aged_count: '2', aged_value: '100' },   // under both
      ],
      newlyBlocked: new Set([H1, H2]),
    });
    const result = await runAutoBlockSweep(q);
    expect(result.enabled).toBe(true);
    expect(result.evaluated).toBe(3);
    expect(result.blocked.map((b) => b.holderId).sort()).toEqual([H1, H2].sort());
    expect(result.alreadyBlocked).toBe(0);
    // H3 (under threshold) must never reach the upsert.
    expect(inserts).not.toContain(H3);
  });

  it('counts an over-threshold holder that was already blocked as alreadyBlocked', async () => {
    const { q } = makeQuerier({
      policy: ENABLED_POLICY,
      sweep: [{ holder_id: H1, aged_count: '5', aged_value: '8000' }],
      newlyBlocked: new Set(), // upsert returns no row → already blocked
    });
    const result = await runAutoBlockSweep(q);
    expect(result.blocked).toHaveLength(0);
    expect(result.alreadyBlocked).toBe(1);
    expect(result.evaluated).toBe(1);
    expect(result.errors).toEqual([]);
  });

  it('isolates a per-holder write failure: records it in errors and still blocks the others', async () => {
    const { q } = makeQuerier({
      policy: ENABLED_POLICY,
      sweep: [
        { holder_id: H1, aged_count: '4', aged_value: '100' }, // write throws
        { holder_id: H2, aged_count: '4', aged_value: '100' }, // blocks ok
      ],
      throwOn: new Set([H1]),
      newlyBlocked: new Set([H2]),
    });
    const result = await runAutoBlockSweep(q);
    expect(result.errors).toEqual([H1]);
    expect(result.blocked.map((b) => b.holderId)).toEqual([H2]);
    expect(result.evaluated).toBe(2);
  });
});
