import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  router: { isReady: false, query: {} as Record<string, string> },
}));

vi.mock('next/router', () => ({ useRouter: () => state.router }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/module-page', () => ({ ModulePage: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/modules/fleet/parking/web/ComplianceTable', () => ({ ComplianceTable: () => null }));

import ParkingCompliancePage from '../index';

describe('ParkingCompliancePage URL filters', () => {
  beforeEach(() => {
    state.router.isReady = false;
    state.router.query = {};
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) {
        return { ok: true, json: async () => ({ success: true, data: null }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true, data: { rows: [] } }) } as Response;
    }));
  });

  it('waits for the router before loading the deep-linked date and result', async () => {
    const view = render(<ParkingCompliancePage />);
    expect(vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/compliance'))).toHaveLength(0);

    state.router.isReady = true;
    state.router.query = { date: '2026-08-12', result: 'violation' };
    view.rerender(<ParkingCompliancePage />);

    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('/compliance'));
      expect(calls).toHaveLength(1);
      expect(String(calls[0]?.[0])).toContain('from=2026-08-12&to=2026-08-12&result=violation');
    });
  });
});
