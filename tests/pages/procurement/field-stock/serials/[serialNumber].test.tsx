/**
 * Unit tests for /procurement/field-stock/serials/[serialNumber] page.
 *
 * Lives under tests/pages/ NOT pages/ because Next.js Pages Router
 * collects .tsx files under pages/ as routes — `__tests__/*.test.tsx`
 * under pages/ crashes `next build` with "Vitest failed to access its
 * internal state" (see PR #1724).
 *
 * Mocks AppLayout + Link + fetch to exercise:
 *   - loading → ok render path with both real-event + pseudo entries
 *   - 404 → not-found pane
 *   - envelope error → error pane
 *   - network error → error pane fallback
 *   - serialNumber URL-encoded into the API request
 *   - credentials:include emitted
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/layout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={typeof href === 'string' ? href : ''} className={className}>{children}</a>
  ),
}));

import SerialTimelinePage from '@/pages/procurement/field-stock/serials/[serialNumber]';

const SERIAL_DETAIL = {
  id: 's1',
  serialNumber: 'PR9A-X',
  macAddress: 'AA:BB:CC:11:22:33',
  category: 'ONT',
  itemName: 'FT-ONT',
  status: 'activated',
  currentLocationName: null,
  allocatedProjectName: 'PR9A Test Project',
  installedAtDropNumber: 'PR9A-DR-0001',
  installedDate: '2026-05-01T08:00:00.000Z',
  receivedDate: '2026-04-01T00:00:00.000Z',
  activatedAtOltId: 'OLT-PR9A-01',
};

function mockFetchOk(data: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({ success: true, data }),
  }) as unknown as typeof fetch;
}

function mockFetchNotFound(message = "Serial with identifier 'PR9A-MISSING' not found") {
  global.fetch = vi.fn().mockResolvedValue({
    status: 404,
    json: async () => ({ success: false, error: { code: 'NOT_FOUND', message } }),
  }) as unknown as typeof fetch;
}

function mockFetchEnvelopeError(message: string) {
  global.fetch = vi.fn().mockResolvedValue({
    status: 400,
    json: async () => ({ success: false, error: { message } }),
  }) as unknown as typeof fetch;
}

function mockFetchNetworkError(reason: string) {
  global.fetch = vi.fn().mockRejectedValue(new Error(reason)) as unknown as typeof fetch;
}

describe('SerialTimelinePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading text on mount, then header + serial', async () => {
    mockFetchOk({ serial: SERIAL_DETAIL, entries: [], hasRealEvents: false });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('PR9A-X').length).toBeGreaterThan(0));
    expect(screen.getByTestId('app-layout')).toBeTruthy();
  });

  it('renders DetailRow values from serial summary', async () => {
    mockFetchOk({ serial: SERIAL_DETAIL, entries: [], hasRealEvents: false });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => screen.getByText('FT-ONT'));
    expect(screen.getByText('ONT')).toBeTruthy();
    expect(screen.getByText('activated')).toBeTruthy();
    expect(screen.getByText('AA:BB:CC:11:22:33')).toBeTruthy();
    expect(screen.getByText('PR9A Test Project')).toBeTruthy();
    expect(screen.getByText('PR9A-DR-0001')).toBeTruthy();
    expect(screen.getByText('OLT-PR9A-01')).toBeTruthy();
  });

  it('renders "No lifecycle events" empty state when entries is empty', async () => {
    mockFetchOk({ serial: SERIAL_DETAIL, entries: [], hasRealEvents: false });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => screen.getByText(/No lifecycle events/));
  });

  it('renders real-event entries with from→to and actor', async () => {
    mockFetchOk({
      serial: SERIAL_DETAIL,
      hasRealEvents: true,
      entries: [
        {
          kind: 'event',
          id: 'evt1',
          eventType: 'activated',
          fromState: 'installed',
          toState: 'activated',
          occurredAt: '2026-05-15T14:00:00.000Z',
          sourceTable: 'oes_pp_data',
          sourceId: null,
          actorName: 'Jane Doe',
          payload: {},
        },
      ],
    });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => screen.getByText('Activated'));
    expect(screen.getByText(/installed → activated/)).toBeTruthy();
    expect(screen.getByText(/Jane Doe/)).toBeTruthy();
    expect(screen.getByText(/2026-05-15 14:00/)).toBeTruthy();
  });

  it('renders pseudo entries with description text', async () => {
    mockFetchOk({
      serial: SERIAL_DETAIL,
      hasRealEvents: false,
      entries: [
        {
          kind: 'pseudo',
          id: 'pseudo-received-s1',
          label: 'Received into stock',
          occurredAt: '2026-04-01T00:00:00.000Z',
          description: 'Inferred from stock_serials.received_date',
        },
      ],
    });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => screen.getByText('Received into stock'));
    expect(screen.getByText('Inferred from stock_serials.received_date')).toBeTruthy();
  });

  it('renders the 404 not-found pane on HTTP 404', async () => {
    mockFetchNotFound();
    render(<SerialTimelinePage serialNumber="PR9A-MISSING" />);
    await waitFor(() => screen.getByText(/No serial matches/));
  });

  it('renders error pane on envelope error (non-404)', async () => {
    mockFetchEnvelopeError('Invalid query parameter serialNumber: must not be empty');
    render(<SerialTimelinePage serialNumber=" " />);
    await waitFor(() =>
      expect(screen.getByText(/Invalid query parameter serialNumber/)).toBeTruthy()
    );
  });

  it('renders error pane on network rejection', async () => {
    mockFetchNetworkError('fetch failed');
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => expect(screen.getByText('fetch failed')).toBeTruthy());
  });

  it('URL-encodes the serialNumber in the API request', async () => {
    mockFetchOk({ serial: SERIAL_DETAIL, entries: [], hasRealEvents: false });
    render(<SerialTimelinePage serialNumber="PR9A SN/01" />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('serialNumber=PR9A%20SN%2F01');
    });
  });

  it('emits credentials:include on the fetch call', async () => {
    mockFetchOk({ serial: SERIAL_DETAIL, entries: [], hasRealEvents: false });
    render(<SerialTimelinePage serialNumber="PR9A-X" />);
    await waitFor(() => {
      const opts = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
      expect(opts.credentials).toBe('include');
    });
  });
});
