/**
 * Tests for retentionUtils — access-log insert + selfie sweep.
 *
 * The sweep has security-sensitive orderings we MUST regression-guard:
 *   - Storage delete happens BEFORE the DB URL nullify. A broken storage
 *     + nulled URL would mean the audit trail points at a missing file
 *     with no way to confirm the delete actually happened.
 *   - `dryRun: true` must not call deleteFile OR mutate the DB.
 *   - DB failures after a successful storage delete are counted in
 *     `dbFailures`, not silently swallowed — so ops can investigate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlResults, sqlCalls, sqlFn } = vi.hoisted(() => {
  const results: Array<unknown[]> = [];
  const calls: Array<{ strings: readonly string[]; values: unknown[] }> = [];
  const fn = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: Array.from(strings), values });
    const next = results.shift();
    return Promise.resolve(next ?? []);
  });
  return { sqlResults: results, sqlCalls: calls, sqlFn: fn };
});

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: sqlFn }));
// Stop the real VFStorageService from trying to construct with env vars.
vi.mock('@/services/vfStorageAdapter', () => ({
  VFStorageService: vi.fn().mockImplementation(() => ({
    deleteFile: vi.fn().mockResolvedValue(true),
  })),
}));

import {
  DEFAULT_RETENTION_DAYS,
  logSelfieAccess,
  sweepExpiredSelfies,
} from '../retentionUtils';

beforeEach(() => {
  sqlResults.length = 0;
  sqlCalls.length = 0;
  sqlFn.mockClear();
});

describe('logSelfieAccess', () => {
  it('writes a row with all fields and context trimmed to 32 chars', async () => {
    sqlResults.push([]);
    await logSelfieAccess({
      entryId: 'entry-1',
      selfieType: 'in',
      viewedBy: 'user-99',
      ipAddress: '203.0.113.5',
      context: 'a'.repeat(80),
    });
    expect(sqlCalls).toHaveLength(1);
    const { values } = sqlCalls[0]!;
    expect(values[0]).toBe('entry-1');
    expect(values[1]).toBe('in');
    expect(values[2]).toBe('user-99');
    expect(values[3]).toBe('203.0.113.5');
    expect((values[4] as string).length).toBe(32);
  });

  it('accepts nullish ip / context', async () => {
    sqlResults.push([]);
    await logSelfieAccess({
      entryId: 'entry-1',
      selfieType: 'out',
      viewedBy: 'user-1',
    });
    const { values } = sqlCalls[0]!;
    expect(values[3]).toBeNull();
    expect(values[4]).toBeNull();
  });

  it('never throws on a DB failure (best-effort audit write)', async () => {
    sqlFn.mockRejectedValueOnce(new Error('boom'));
    await expect(
      logSelfieAccess({ entryId: 'e', selfieType: 'in', viewedBy: 'u' })
    ).resolves.toBeUndefined();
  });
});

describe('sweepExpiredSelfies', () => {
  function mockStorage(result: boolean | Array<boolean>) {
    const deleteFile = Array.isArray(result)
      ? vi.fn(() => Promise.resolve(result.shift() ?? true))
      : vi.fn().mockResolvedValue(result);
    return { deleteFile };
  }

  it('returns an empty report when no rows match', async () => {
    sqlResults.push([]); // SELECT → 0 rows
    const storage = mockStorage(true);
    const report = await sweepExpiredSelfies({ storage });
    expect(report).toEqual({
      entriesScanned: 0,
      inSelfiesDeleted: 0,
      outSelfiesDeleted: 0,
      storageFailures: 0,
      dbFailures: 0,
      dryRun: false,
    });
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('deletes both selfies and nullifies both columns per row', async () => {
    sqlResults.push([
      {
        id: 'entry-1',
        staff_id: 'staff-1',
        work_date: '2026-01-01',
        selfie_in_url: '/storage/attendance/staff-1/2026-01-01/in.jpg',
        selfie_out_url: '/storage/attendance/staff-1/2026-01-01/out.jpg',
      },
    ]);
    // UPDATE in + UPDATE out
    sqlResults.push([]);
    sqlResults.push([]);

    const storage = mockStorage(true);
    const report = await sweepExpiredSelfies({ storage });

    expect(storage.deleteFile).toHaveBeenCalledWith('attendance', 'staff-1/2026-01-01', 'in.jpg');
    expect(storage.deleteFile).toHaveBeenCalledWith('attendance', 'staff-1/2026-01-01', 'out.jpg');
    expect(report.inSelfiesDeleted).toBe(1);
    expect(report.outSelfiesDeleted).toBe(1);
    expect(report.storageFailures).toBe(0);
  });

  it('storage delete happens BEFORE DB update (order is load-bearing)', async () => {
    sqlResults.push([
      {
        id: 'e1',
        staff_id: 's1',
        work_date: '2026-01-01',
        selfie_in_url: '/a',
        selfie_out_url: null,
      },
    ]);
    sqlResults.push([]); // UPDATE

    const order: string[] = [];
    const storage = {
      deleteFile: vi.fn(async () => { order.push('storage'); return true; }),
    };
    // Wrap sqlFn so we can record "db" calls interleaved with "storage".
    const originalImpl = sqlFn.getMockImplementation();
    sqlFn.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
      const joined = strings.join('');
      if (joined.includes('UPDATE attendance_entries')) order.push('db');
      return originalImpl!(strings as TemplateStringsArray, ...values);
    });

    await sweepExpiredSelfies({ storage });
    expect(order).toEqual(['storage', 'db']);
  });

  it('counts storage failures without touching the DB for that file', async () => {
    sqlResults.push([
      {
        id: 'e1',
        staff_id: 's1',
        work_date: '2026-01-01',
        selfie_in_url: '/a',
        selfie_out_url: null,
      },
    ]);
    // No UPDATE queued — this test asserts the UPDATE never runs.

    const storage = mockStorage(false);
    const report = await sweepExpiredSelfies({ storage });

    expect(report.inSelfiesDeleted).toBe(0);
    expect(report.storageFailures).toBe(1);
    // Only 1 sql call: the initial SELECT.
    expect(sqlCalls).toHaveLength(1);
  });

  it('counts dbFailures when the UPDATE rejects after a successful delete', async () => {
    sqlResults.push([
      {
        id: 'e1',
        staff_id: 's1',
        work_date: '2026-01-01',
        selfie_in_url: '/a',
        selfie_out_url: null,
      },
    ]);
    sqlFn.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ strings: Array.from(strings), values });
      return Promise.resolve(sqlResults.shift() ?? []);
    });
    // First after SELECT is the UPDATE — make it reject.
    sqlFn.mockImplementationOnce(() => Promise.reject(new Error('pg down')));

    const storage = mockStorage(true);
    const report = await sweepExpiredSelfies({ storage });

    expect(report.inSelfiesDeleted).toBe(0);
    expect(report.dbFailures).toBe(1);
    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
  });

  it('dryRun: logs what it would do but does not call deleteFile or UPDATE', async () => {
    sqlResults.push([
      {
        id: 'e1',
        staff_id: 's1',
        work_date: '2026-01-01',
        selfie_in_url: '/a',
        selfie_out_url: '/b',
      },
    ]);
    const storage = mockStorage(true);
    const report = await sweepExpiredSelfies({ dryRun: true, storage });
    expect(storage.deleteFile).not.toHaveBeenCalled();
    // Only the SELECT ran; no UPDATE.
    expect(sqlCalls).toHaveLength(1);
    expect(report.inSelfiesDeleted).toBe(0);
    expect(report.outSelfiesDeleted).toBe(0);
    expect(report.dryRun).toBe(true);
    expect(report.entriesScanned).toBe(1);
  });

  it('passes retentionDays through to the SELECT', async () => {
    sqlResults.push([]);
    await sweepExpiredSelfies({ retentionDays: 30 });
    const { values } = sqlCalls[0]!;
    expect(values).toContain(30);
  });

  it('uses DEFAULT_RETENTION_DAYS = 90 when unset', async () => {
    sqlResults.push([]);
    await sweepExpiredSelfies();
    const { values } = sqlCalls[0]!;
    expect(values).toContain(DEFAULT_RETENTION_DAYS);
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
  });

  it('handles a row with only in-selfie set', async () => {
    sqlResults.push([
      {
        id: 'e1',
        staff_id: 's1',
        work_date: '2026-01-01',
        selfie_in_url: '/a',
        selfie_out_url: null,
      },
    ]);
    sqlResults.push([]);
    const storage = mockStorage(true);
    const report = await sweepExpiredSelfies({ storage });
    expect(storage.deleteFile).toHaveBeenCalledTimes(1);
    expect(report.inSelfiesDeleted).toBe(1);
    expect(report.outSelfiesDeleted).toBe(0);
  });
});
