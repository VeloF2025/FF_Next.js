/**
 * Tests for runLocalResolution — the PP local-resolution scan reused by the
 * nightly pp-reresolve cron.
 *
 * Focus is the two behaviours that were silently wrong in production: a source
 * whose query cannot run was indistinguishable from one that ran and matched
 * nothing, and the offline_devices pass used an OR'd predicate that Postgres
 * could not hash-join (386M row comparisons, ~200s of a 239s runtime).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('@/lib/db', () => ({ default: { query: mocks.query } }));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withRole: () => (h: unknown) => h,
}));
vi.mock('@/services/onemap', () => ({ createOneMapClient: vi.fn() }));
vi.mock('@/modules/activate/services/serialVerificationService', () => ({
  extractWaPhotoSerials: vi.fn(),
}));
vi.mock('@/modules/noc/services/ticketService', () => ({ logTicketActivity: vi.fn() }));
vi.mock('@/modules/activate/services/cascadePpResolution', () => ({
  cascadePpResolution: vi.fn(),
}));

import { runLocalResolution } from '../../../../../pages/api/activate/pp-data-resolve';

/** Every UPDATE statement the scan issued, in order. */
function issuedQueries(): string[] {
  return mocks.query.mock.calls.map((c) => String(c[0]));
}

beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rowCount: 0 });
});

describe('runLocalResolution — failure reporting', () => {
  it('reports no failures when every source runs', async () => {
    const result = await runLocalResolution();
    expect(result.failures).toEqual([]);
  });

  // The production bug: matchSource caught everything and returned 0, so a
  // source pointing at a non-existent table looked exactly like a clean run.
  it('records a source whose query throws, instead of silently returning 0', async () => {
    mocks.query.mockImplementation((sql: string) =>
      String(sql).includes('drops d')
        ? Promise.reject(new Error('relation "drops" does not exist'))
        : Promise.resolve({ rowCount: 0 }),
    );

    const result = await runLocalResolution();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].source).toBe('drops');
    expect(result.failures[0].error).toContain('does not exist');
  });

  it('keeps scanning the remaining sources after one fails', async () => {
    mocks.query.mockImplementation((sql: string) =>
      String(sql).includes('oes_activations oa')
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ rowCount: 1 }),
    );

    const result = await runLocalResolution();

    expect(result.failures).toHaveLength(1);
    // Later sources still ran and still counted.
    expect(result.total_resolved).toBeGreaterThan(0);
  });

  it('does not throw when a source fails', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'));
    await expect(runLocalResolution()).resolves.toBeDefined();
  });
});

describe('runLocalResolution — offline_devices split', () => {
  function offlineDeviceQueries(): string[] {
    return issuedQueries().filter((q) => q.includes('FROM offline_devices'));
  }

  it('queries offline_devices once per serial column', async () => {
    await runLocalResolution();
    expect(offlineDeviceQueries()).toHaveLength(3);
  });

  // The regression guard: an OR of three different equalities cannot be
  // hash-joined, which is what produced the 386M-comparison nested loop.
  it('uses no OR in any offline_devices predicate', async () => {
    await runLocalResolution();
    for (const q of offlineDeviceQueries()) {
      expect(q).not.toMatch(/\bOR\b/);
    }
  });

  it('covers serial_number, expected_serial and olt_serial exactly once each', async () => {
    await runLocalResolution();
    const queries = offlineDeviceQueries();
    for (const column of ['serial_number', 'expected_serial', 'olt_serial']) {
      const matching = queries.filter((q) =>
        q.includes(`UPPER(TRIM(od.${column})) = UPPER(TRIM(pp.serial_number))`),
      );
      expect(matching, `expected exactly one pass on ${column}`).toHaveLength(1);
    }
  });

  it('reports all three passes under one accumulated source name', async () => {
    mocks.query.mockImplementation((sql: string) =>
      Promise.resolve({ rowCount: String(sql).includes('FROM offline_devices') ? 2 : 0 }),
    );

    const result = await runLocalResolution();

    // 3 passes x 2 rows, reported once — not three separate keys.
    expect(result.sources.offline_devices).toBe(6);
  });
});

describe('runLocalResolution — dead source removal', () => {
  // arch_offline_devices exists in no schema on this database; the pass threw
  // on every run and was swallowed. With failures now surfaced it would report
  // an error daily, so it was removed rather than left to cry wolf.
  it('no longer queries arch_offline_devices', async () => {
    await runLocalResolution();
    expect(issuedQueries().some((q) => q.includes('arch_offline_devices'))).toBe(false);
  });
});
