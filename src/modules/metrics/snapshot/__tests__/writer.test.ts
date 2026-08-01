import { describe, it, expect, vi } from 'vitest';
import { writeSnapshot } from '../writer';

const asOf = '2026-08-01';

function fakeDeps({ locked = true, alreadyDone = false, insertFails = false } = {}) {
  const calls: string[] = [];
  const query = vi.fn(async (sql: string) => {
    calls.push(sql.trim().split('\n')[0] as string);
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return {};
    if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [{ locked }] };
    if (sql.includes('SELECT 1 FROM snapshot_runs')) {
      return { rows: alreadyDone ? [{ exists: 1 }] : [] };
    }
    if (sql.includes('DELETE FROM metric_snapshots')) return { rowCount: 0 };
    if (sql.includes('INSERT INTO metric_snapshots')) {
      if (insertFails) throw new Error('boom');
      return { rowCount: 2 };
    }
    if (sql.includes('INSERT INTO snapshot_runs')) return { rowCount: 1 };
    return { rows: [] };
  });
  return { query, calls };
}

const wroteRows = (deps: { calls: string[] }) =>
  deps.calls.some((c) => c.includes('INSERT INTO metric_snapshots'));
const loggedCompletion = (deps: { calls: string[] }) =>
  deps.calls.some((c) => c.includes('INSERT INTO snapshot_runs'));

describe('writeSnapshot', () => {
  it('writes rows and logs completion when it takes the lock', async () => {
    const deps = fakeDeps();
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({
      rows: 2,
      skipped: false,
      written: true,
    });
    expect(deps.calls).toContain('COMMIT');
    expect(loggedCompletion(deps)).toBe(true);
  });

  it('reports NOT written when a concurrent run holds the lock', async () => {
    const deps = fakeDeps({ locked: false });
    // written:false is the point — losing the race is not success. The winner may
    // still roll back, so the caller must be able to tell "not done" from "done".
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({
      rows: 0,
      skipped: true,
      written: false,
    });
    expect(wroteRows(deps)).toBe(false);
    expect(deps.calls).toContain('ROLLBACK');
  });

  it('reports written when the day is already complete', async () => {
    const deps = fakeDeps({ alreadyDone: true });
    expect(await writeSnapshot('pp_open', asOf, deps)).toEqual({
      rows: 0,
      skipped: true,
      written: true,
    });
    expect(wroteRows(deps)).toBe(false);
  });

  it('rolls back and records nothing when the insert throws, so the day retries', async () => {
    const deps = fakeDeps({ insertFails: true });
    await expect(writeSnapshot('pp_open', asOf, deps)).rejects.toThrow('boom');
    expect(deps.calls).toContain('ROLLBACK');
    // Absence of a completion row is what makes the next run retry the day.
    expect(loggedCompletion(deps)).toBe(false);
  });

  it('surfaces the original error even when ROLLBACK itself fails', async () => {
    const deps = fakeDeps({ insertFails: true });
    const inner = deps.query;
    const wrapped = vi.fn(async (sql: string) => {
      if (sql.trim().startsWith('ROLLBACK')) throw new Error('rollback exploded');
      return inner(sql);
    });
    await expect(
      writeSnapshot('pp_open', asOf, { query: wrapped as unknown as typeof inner }),
    ).rejects.toThrow('boom');
  });

  it('rejects an unregistered source rather than silently writing nothing', async () => {
    await expect(writeSnapshot('not_a_source', asOf, fakeDeps())).rejects.toThrow(
      /unknown snapshot source/i,
    );
  });
});
