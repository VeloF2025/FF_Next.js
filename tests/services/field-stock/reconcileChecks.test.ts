import { describe, it, expect, vi, beforeEach } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));
vi.mock('node:fs', () => ({ readFileSync: readFileSyncMock }));

import { parseChecks, loadReconcileChecks } from '@/modules/procurement/field-stock/services/reconcileChecks';

describe('parseChecks', () => {
  it('parses name, tolerance and SQL from an annotated block', () => {
    const src = `-- @name latest_event_matches_status
-- Tolerance: 0
-- description line
SELECT COUNT(*) AS drift_count FROM stock_serials;`;
    const checks = parseChecks(src);
    expect(checks).toEqual([
      { name: 'latest_event_matches_status', tolerance: 0, sql: 'SELECT COUNT(*) AS drift_count FROM stock_serials;' },
    ]);
  });

  it('defaults tolerance to 0 when no Tolerance comment is present', () => {
    const src = `-- @name some_check
SELECT COUNT(*) AS drift_count FROM t;`;
    expect(parseChecks(src)[0]?.tolerance).toBe(0);
  });

  it('parses multiple checks and ignores the file header / prose mentioning @name', () => {
    const src = `-- Each query is identified by a @name comment (prose, not a real check).
-- @name a
-- Tolerance: 5
SELECT COUNT(*) AS drift_count FROM a;
-- @name b
-- Tolerance: 100
SELECT COUNT(*) AS drift_count FROM b;`;
    const checks = parseChecks(src);
    expect(checks.map((c) => c.name)).toEqual(['a', 'b']);
    expect(checks.map((c) => c.tolerance)).toEqual([5, 100]);
  });

  it('skips a named block that has no SELECT statement', () => {
    const src = `-- @name broken
-- Tolerance: 0
-- no sql here`;
    expect(parseChecks(src)).toEqual([]);
  });
});

describe('loadReconcileChecks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('reads and parses the on-disk SQL into check specs', () => {
    readFileSyncMock.mockReturnValue(`-- @name a
-- Tolerance: 0
SELECT COUNT(*) AS drift_count FROM a;`);
    const checks = loadReconcileChecks();
    expect(checks).toEqual([{ name: 'a', tolerance: 0, sql: 'SELECT COUNT(*) AS drift_count FROM a;' }]);
  });

  it('throws when the file yields zero checks (never returns an empty gate)', () => {
    readFileSyncMock.mockReturnValue('-- just a header comment, no checks');
    expect(() => loadReconcileChecks()).toThrow(/No reconcile checks parsed/);
  });

  it('propagates a file-read failure rather than swallowing it', () => {
    readFileSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => loadReconcileChecks()).toThrow('ENOENT');
  });
});
