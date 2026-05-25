import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getDashboardV2Summary } from '@/modules/procurement/field-stock/services/dashboardV2Service';

describe('getDashboardV2Summary', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shapes the four metric groups from raw rows', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { name: 'Main WH', type: 'warehouse', value: '1500.50', item_count: '3' },
        { name: 'Site A', type: 'site_store', value: '200', item_count: '1' },
      ])
      .mockResolvedValueOnce([
        { name: 'Acme', held_value: '500', unaccounted_value: '300', is_blocked: true, pending_recovery: '50' },
        { name: 'Bolt', held_value: '100', unaccounted_value: '0', is_blocked: false, pending_recovery: '0' },
      ])
      .mockResolvedValueOnce([
        { status: 'installed', cnt: '4', recent_installed: '1', recent_activated: '0' },
        { status: 'activated', cnt: '6', recent_installed: '0', recent_activated: '2' },
      ])
      .mockResolvedValueOnce([
        { stagnant_count: '7', stagnant_value: '900.25', issued_not_installed: '5' },
      ]);

    const result = await getDashboardV2Summary();

    expect(result.stockValue.total).toBe(1700.5);
    expect(result.stockValue.byLocation).toEqual([
      { name: 'Main WH', type: 'warehouse', value: 1500.5, itemCount: 3 },
      { name: 'Site A', type: 'site_store', value: 200, itemCount: 1 },
    ]);
    expect(result.contractorExposure.totalHeldValue).toBe(600);
    expect(result.contractorExposure.totalUnaccountedValue).toBe(300);
    expect(result.contractorExposure.blockedCount).toBe(1);
    expect(result.contractorExposure.totalPendingRecovery).toBe(50);
    expect(result.contractorExposure.top[0]).toEqual({
      name: 'Acme', heldValue: 500, unaccountedValue: 300, isBlocked: true,
    });
    expect(result.serialsLifecycle.byStatus).toEqual({ installed: 4, activated: 6 });
    expect(result.serialsLifecycle.installed).toBe(4);
    expect(result.serialsLifecycle.activated).toBe(6);
    expect(result.serialsLifecycle.recentlyInstalled).toBe(1);
    expect(result.serialsLifecycle.recentlyActivated).toBe(2);
    expect(result.ageing).toEqual({
      thresholdDays: 30,
      stagnantStockCount: 7,
      stagnantStockValue: 900.25,
      serialsIssuedNotInstalled: 5,
    });
  });
});
