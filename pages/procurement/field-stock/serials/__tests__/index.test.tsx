/**
 * Unit tests for /procurement/field-stock/serials page component.
 *
 * Mocks useRouter + fetch + AppLayout + SerialSearch so the test exercises:
 *   - the queryToFilters↔filtersToQuery roundtrip (URL ⇄ filter state)
 *   - the loading → results render path
 *   - the env.success === false error-rendering branch
 *   - the network catch branch
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const { routerMock } = vi.hoisted(() => ({
  routerMock: { query: {} as Record<string, string | string[] | undefined>, replace: vi.fn() },
}));

vi.mock('next/router', () => ({
  useRouter: () => routerMock,
}));
vi.mock('@/components/layout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));
vi.mock('@/components/field-stock/SerialSearch', () => ({
  SerialSearch: ({ initialFilters }: { initialFilters: unknown }) => (
    <div data-testid="serial-search">{JSON.stringify(initialFilters)}</div>
  ),
}));

import SerialsSearchPage from '../index';

function mockFetchSuccess(rows: Array<Record<string, unknown>>, total: number) {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, data: { rows, total, page: 1, pageSize: 50 } }),
  }) as unknown as typeof fetch;
}

function mockFetchEnvelopeError(message: string) {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: false, error: { message } }),
  }) as unknown as typeof fetch;
}

function mockFetchNetworkError(reason: string) {
  global.fetch = vi.fn().mockRejectedValue(new Error(reason)) as unknown as typeof fetch;
}

describe('SerialsSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routerMock.query = {};
    routerMock.replace.mockReset();
  });

  it('renders AppLayout chrome and passes initialFilters to SerialSearch', async () => {
    mockFetchSuccess([], 0);
    render(<SerialsSearchPage initialFilters={{ q: 'ABC' }} />);
    expect(screen.getByTestId('app-layout')).toBeTruthy();
    expect(screen.getByTestId('serial-search').textContent).toContain('"q":"ABC"');
    expect(screen.getByText('Serial register')).toBeTruthy();
  });

  it('shows loading text on mount, then row count', async () => {
    mockFetchSuccess(
      [{ id: 'r1', serialNumber: 'PR8-X', macAddress: null, category: 'ONT', itemName: 'ONT', status: 'available', currentLocationName: null, allocatedProjectName: null, installedAtDropNumber: null, lastEventType: null, lastEventAt: null }],
      1
    );
    render(<SerialsSearchPage initialFilters={{}} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('1 result')).toBeTruthy());
  });

  it('pluralises result count correctly (0 results, N results)', async () => {
    mockFetchSuccess([], 0);
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => expect(screen.getByText('0 results')).toBeTruthy());
  });

  it('renders error envelope from API in the error pane', async () => {
    mockFetchEnvelopeError('Invalid query parameter pageSize: must be between 1 and 200');
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Invalid query parameter pageSize/)
      ).toBeTruthy()
    );
  });

  it('renders network-error fallback in the error pane', async () => {
    mockFetchNetworkError('fetch failed');
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => expect(screen.getByText('fetch failed')).toBeTruthy());
  });

  it('renders a row with clickable link, encoded serial number', async () => {
    mockFetchSuccess(
      [{
        id: 'r1',
        serialNumber: 'PR8-SN-AVAIL-01',
        macAddress: 'BB:BB:CC:00:00:01',
        category: 'ONT',
        itemName: 'ONT',
        status: 'available',
        currentLocationName: 'PR8 Warehouse',
        allocatedProjectName: null,
        installedAtDropNumber: null,
        lastEventType: 'received_at_warehouse',
        lastEventAt: '2026-05-20T10:30:00Z',
      }],
      1
    );
    render(<SerialsSearchPage initialFilters={{}} />);
    const link = await waitFor(() => screen.getByRole('link', { name: /PR8-SN-AVAIL-01/ }));
    expect(link.getAttribute('href')).toBe('/procurement/field-stock/serials/PR8-SN-AVAIL-01');
    expect(screen.getByText('BB:BB:CC:00:00:01')).toBeTruthy();
    expect(screen.getByText('PR8 Warehouse')).toBeTruthy();
    expect(screen.getByText('received_at_warehouse')).toBeTruthy();
    expect(screen.getByText('2026-05-20')).toBeTruthy();
  });

  it('reads filters from router.query on update (URL → state)', async () => {
    mockFetchSuccess([], 0);
    routerMock.query = { q: 'XYZ', status: 'available,installed', projectId: 'aaaaaaaa-0000-0000-0000-000000000004' };
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('q=XYZ');
      expect(url).toContain('status=available%2Cinstalled');
      expect(url).toContain('projectId=aaaaaaaa-0000-0000-0000-000000000004');
    });
  });

  it('emits credentials:include on the fetch call', async () => {
    mockFetchSuccess([], 0);
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => {
      const opts = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect(opts.credentials).toBe('include');
    });
  });

  it('shows "—" placeholders for null optional cells', async () => {
    mockFetchSuccess(
      [{
        id: 'r1',
        serialNumber: 'PR8-A',
        macAddress: null,
        category: null,
        itemName: null,
        status: 'available',
        currentLocationName: null,
        allocatedProjectName: null,
        installedAtDropNumber: null,
        lastEventType: null,
        lastEventAt: null,
      }],
      1
    );
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => screen.getByRole('link', { name: 'PR8-A' }));
    const dashes = screen.getAllByText('—');
    // Category, location, project, last-event = 4 placeholders for this row.
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });

  it('falls back to installedAtDropNumber when currentLocationName is null', async () => {
    mockFetchSuccess(
      [{
        id: 'r1',
        serialNumber: 'PR8-INST',
        macAddress: null,
        category: null,
        itemName: null,
        status: 'installed',
        currentLocationName: null,
        allocatedProjectName: null,
        installedAtDropNumber: 'PR8-DR-0001',
        lastEventType: null,
        lastEventAt: null,
      }],
      1
    );
    render(<SerialsSearchPage initialFilters={{}} />);
    await waitFor(() => expect(screen.getByText('PR8-DR-0001')).toBeTruthy());
  });
});
