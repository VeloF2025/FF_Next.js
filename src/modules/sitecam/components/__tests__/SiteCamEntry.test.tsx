import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SiteCamEntry } from '../SiteCamEntry';

const profile = { name: 'Tech', profilePhotoUrl: null } as never;

function mockSiteFetch(data: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) }),
  ));
}

beforeEach(() => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) =>
        err({ code: 1 } as GeolocationPositionError),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SiteCamEntry meta grid + geofence warning', () => {
  it('shows PON/zone/coords after a successful lookup', async () => {
    mockSiteFetch({
      jobType: 'activations', siteId: 'DR1854086', customerName: 'John', address: '1 Main Rd',
      projectName: 'Mohadin', plannedLat: -26.12345, plannedLon: 27.56789, pon: 12, zone: 4,
    });
    render(<SiteCamEntry profile={profile} />);
    fireEvent.change(screen.getByLabelText(/DR \/ Pole Number/i), { target: { value: 'DR1854086' } });
    fireEvent.click(screen.getByText('Find'));
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText(/-26\.12345, 27\.56789/)).toBeTruthy();
  });

  it('shows a device-GPS warning banner when Start Capture is tapped with GPS denied', async () => {
    mockSiteFetch({
      jobType: 'activations', siteId: 'DR1', customerName: null, address: null,
      projectName: null, plannedLat: -26.1, plannedLon: 27.5, pon: 1, zone: 1,
    });
    render(<SiteCamEntry profile={profile} />);
    fireEvent.change(screen.getByLabelText(/DR \/ Pole Number/i), { target: { value: 'DR1' } });
    fireEvent.click(screen.getByText('Find'));
    await waitFor(() => screen.getByText('Start Capture'));
    fireEvent.click(screen.getByText('Start Capture'));
    await waitFor(() => expect(screen.getByText(/location/i)).toBeTruthy());
    expect(screen.getByText(/Continue anyway/i)).toBeTruthy();
  });
});
