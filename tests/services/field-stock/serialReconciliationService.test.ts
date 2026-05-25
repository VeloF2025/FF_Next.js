import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, loadChecksMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  loadChecksMock: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => ({ query: queryMock }));
vi.mock('@/modules/procurement/field-stock/services/reconcileChecks', () => ({
  loadReconcileChecks: loadChecksMock,
}));

import { getSerialReconciliationSummary } from '@/modules/procurement/field-stock/services/serialReconciliationService';

describe('getSerialReconciliationSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadChecksMock.mockReturnValue([
      { name: 'zero_tol', tolerance: 0, sql: 'SELECT 1 AS drift_count;' },
      { name: 'wide_tol', tolerance: 100, sql: 'SELECT 1 AS drift_count;' },
    ]);
  });

  it('maps drift to pass/fail against each tolerance', async () => {
    queryMock
      .mockResolvedValueOnce([{ drift_count: '3' }]) // zero_tol: 3 > 0 → fail
      .mockResolvedValueOnce([{ drift_count: '42' }]); // wide_tol: 42 <= 100 → pass

    const summary = await getSerialReconciliationSummary();

    expect(summary.checks).toEqual([
      { name: 'zero_tol', tolerance: 0, drift: 3, passed: false },
      { name: 'wide_tol', tolerance: 100, drift: 42, passed: true },
    ]);
    expect(summary.allPassed).toBe(false);
    expect(summary.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('treats a missing row / null drift_count as 0 drift (passing for tolerance 0)', async () => {
    queryMock
      .mockResolvedValueOnce([]) // no rows
      .mockResolvedValueOnce([{ drift_count: 0 }]);

    const summary = await getSerialReconciliationSummary();

    expect(summary.checks[0]).toEqual({ name: 'zero_tol', tolerance: 0, drift: 0, passed: true });
    expect(summary.allPassed).toBe(true);
  });

  it('runs the checks sequentially (one query per check, in order)', async () => {
    queryMock.mockResolvedValue([{ drift_count: '0' }]);
    await getSerialReconciliationSummary();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0]?.[0]).toContain('SELECT 1 AS drift_count');
  });
});
