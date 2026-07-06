import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/modules/sitecam/lib/sitecamAuth', () => ({
  isSiteCamAuthorised: () => true,
}));

const getSessionMock = vi.fn();
vi.mock('@/modules/attendance/portal/client/api', () => ({
  getSession: () => getSessionMock(),
}));

const findRestorableSiteCamJobMock = vi.fn();
vi.mock('@/modules/sitecam/offline/findRestorableSiteCamJob', () => ({
  findRestorableSiteCamJob: (staffId: string, siteId: string) => findRestorableSiteCamJobMock(staffId, siteId),
}));

vi.mock('@/modules/sitecam/components/SiteCamWizard', () => ({
  SiteCamWizard: ({ siteInfo }: { siteInfo: { siteId: string; customerName: string | null } }) => (
    <div data-testid="wizard">
      wizard:{siteInfo.siteId}:{siteInfo.customerName ?? 'none'}
    </div>
  ),
}));

let routerQuery: Record<string, string | undefined> = {};
vi.mock('next/router', () => ({
  useRouter: () => ({ query: routerQuery, push: vi.fn(), replace: vi.fn() }),
}));

import SiteCamWizardPage from '../[siteId]';

const PROFILE = {
  staffId: 's1', name: 'Tech', phone: null, email: null, homeSiteId: null,
  hasAssignedVehicle: false, profilePhotoUrl: null, role: 'technician', accountStatus: 'active', authRole: null,
};

beforeEach(() => {
  routerQuery = { siteId: 'DR-WARM-1' };
  getSessionMock.mockReset();
  findRestorableSiteCamJobMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SiteCamWizardPage warm-start restore (Task 7)', () => {
  it('renders the wizard from a restored job when the site fetch fails but IDB has the job', async () => {
    getSessionMock.mockResolvedValue({ session: { sessionId: 's', staffId: 's1', method: 'pin', expiresAt: '' }, profile: PROFILE });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: 'Could not reach server' }) })));
    findRestorableSiteCamJobMock.mockResolvedValue({
      jobType: 'activations',
      siteInfo: {
        jobType: 'activations', siteId: 'DR-WARM-1', customerName: 'Jane Tech', address: null,
        projectName: null, plannedLat: null, plannedLon: null, pon: null, zone: null,
      },
    });

    render(<SiteCamWizardPage />);

    await waitFor(() => expect(screen.getByTestId('wizard')).toBeTruthy());
    expect(screen.getByTestId('wizard').textContent).toBe('wizard:DR-WARM-1:Jane Tech');
    // Scoped to the CURRENT staff member's session (shared-device fix) — not
    // a bare siteId lookup that any signed-in tech could restore.
    expect(findRestorableSiteCamJobMock).toHaveBeenCalledWith('s1', 'DR-WARM-1');
  });

  it('falls back to the "Site not found" error when the site fetch fails and no IDB job exists', async () => {
    getSessionMock.mockResolvedValue({ session: { sessionId: 's', staffId: 's1', method: 'pin', expiresAt: '' }, profile: PROFILE });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'No site found' }) })));
    findRestorableSiteCamJobMock.mockResolvedValue(null);

    render(<SiteCamWizardPage />);

    await waitFor(() => expect(screen.getByText('Site not found')).toBeTruthy());
    expect(screen.queryByTestId('wizard')).toBeNull();
  });

  it('renders the wizard from the live fetch when the site lookup succeeds (no restore needed)', async () => {
    getSessionMock.mockResolvedValue({ session: { sessionId: 's', staffId: 's1', method: 'pin', expiresAt: '' }, profile: PROFILE });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        data: {
          jobType: 'activations', siteId: 'DR-WARM-1', customerName: 'Live Customer', address: null,
          projectName: null, plannedLat: null, plannedLon: null, pon: null, zone: null,
        },
      }),
    })));

    render(<SiteCamWizardPage />);

    await waitFor(() => expect(screen.getByTestId('wizard')).toBeTruthy());
    expect(screen.getByTestId('wizard').textContent).toBe('wizard:DR-WARM-1:Live Customer');
    expect(findRestorableSiteCamJobMock).not.toHaveBeenCalled();
  });
});
