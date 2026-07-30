import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('next/head', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({
    query: { vehicleId: 'vehicle-tampered', type: 'daily' },
    push: vi.fn(),
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: null }),
}));

vi.mock('@/modules/fleet/portal', () => ({
  usePortalSession: () => ({
    session: {
      sessionId: 'portal-session-1',
      vehicleId: 'vehicle-assigned',
      vehicleRegistration: 'ABC 123 GP',
      driverId: 'staff-1',
      driverName: 'Assigned Driver',
      source: 'my',
    },
    isLoading: false,
  }),
}));

vi.mock('@/components/layout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/modules/fleet/check-in/components/CheckInForm', () => ({
  CheckInForm: () => <div>Check-in form</div>,
}));

vi.mock('@/modules/fleet/check-in/components/CheckInSummary', () => ({
  CheckInSummary: () => <div>Check-in summary</div>,
}));

vi.mock('@/modules/fleet/check-in/components/OfflineIndicator', () => ({
  OfflineIndicator: () => null,
}));

import CheckInPage from '../../../../pages/fleet/check-in';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fleet check-in portal vehicle binding', () => {
  it('uses the signed portal vehicle instead of a tampered URL vehicle', async () => {
    mocks.fetch.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('/api/fleet/vehicles?id=')) {
        const id = new URLSearchParams(url.split('?')[1]).get('id');
        return {
          ok: true,
          json: async () => ({
            data: {
              id,
              registration: 'ABC 123 GP',
              make: 'Toyota',
              model: 'Hilux',
            },
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({ data: { canUse: true } }),
      };
    });
    vi.stubGlobal('fetch', mocks.fetch);

    render(<CheckInPage />);

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/fleet/vehicles?id=vehicle-assigned'
      );
    });
    expect(mocks.fetch).not.toHaveBeenCalledWith(
      '/api/fleet/vehicles?id=vehicle-tampered'
    );
    expect(
      await screen.findByText(/Assigned vehicle confirmed/)
    ).toBeInTheDocument();
  });
});
