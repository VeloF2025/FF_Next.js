/** @vitest-environment jsdom */
/**
 * The seam on /fleet/analytics.
 *
 * The point of this file is the FIRST test: PR8 adds a section to a page that
 * already earns its keep, and the vehicle scorecard surviving that addition is
 * a claim worth a test rather than an inspection of the diff.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

const mocks = vi.hoisted(() => ({ report: vi.fn() }));

vi.mock('next/router', () => ({
  useRouter: () => ({ replace: vi.fn(), query: {}, pathname: '/fleet/analytics' }),
}));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));
vi.mock('@/components/module-page', () => ({
  ModulePage: ({ children }: { children: React.ReactNode }) => <div data-testid="module-page">{children}</div>,
}));
vi.mock('@/services/core/NotificationService', () => ({ notificationService: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/modules/fleet/incidents/web/operationsAnalyticsApi', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/incidents/web/operationsAnalyticsApi')>(
    '@/modules/fleet/incidents/web/operationsAnalyticsApi',
  );
  return { ...actual, operationsAnalyticsApi: { report: mocks.report, drillDown: vi.fn() } };
});

import FleetAnalyticsPage from '@/pages/fleet/analytics/index';

const scorecard = {
  vehicles: [], daysInRange: 90,
  summary: { totalVehicles: 0, totalKm: 0, totalFuelCost: 0, totalFuelLitres: 0, totalCheckIns: 0 },
};

async function flush(): Promise<void> {
  await act(async () => { for (let tick = 0; tick < 6; tick += 1) await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/fleet/analytics');
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ success: true, data: scorecard }),
  }) as unknown as typeof fetch;
  mocks.report.mockResolvedValue({
    filters: { start: '2026-01-01', end: '2026-03-31' }, metricVersion: 1,
    retainedDetailFrom: '2026-02-01', cards: [], series: [], suppressionNotices: [],
    freshness: { aggregatesThrough: '2026-07-01', lastRunStatus: 'succeeded' },
  });
});

describe('/fleet/analytics', () => {
  it('keeps the vehicle scorecard it already had', async () => {
    render(<FleetAnalyticsPage />);
    await flush();
    expect(screen.getByText('Fleet Analytics')).toBeTruthy();
    expect(screen.getByText(/Vehicle Scorecard/)).toBeTruthy();
  });

  it('adds the Operations section below it', async () => {
    render(<FleetAnalyticsPage />);
    await flush();
    expect(screen.getByTestId('operations-analytics')).toBeTruthy();
  });

  /**
   * The scorecard's own controls are component state and never reach the URL.
   * If the Operations section ever wrote a bare filter name, this is where the
   * two filter sets would start reading each other's values.
   */
  it('leaves the scorecard filters untouched by the Operations request', async () => {
    render(<FleetAnalyticsPage />);
    await flush();
    const scorecardCalls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.includes('vehicle-scorecard'));
    expect(scorecardCalls.length).toBeGreaterThan(0);
    for (const url of scorecardCalls) expect(url).not.toContain('op_');
  });
});
