/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock, back: vi.fn() }) }));

vi.mock('../MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('../AttendanceRequiredActionCard', () => ({ AttendanceRequiredActionCard: () => null }));
vi.mock('../ComplianceReminders', () => ({ ComplianceReminders: () => null }));
vi.mock('@/modules/field-stock-pwa/lib/storesRoles', () => ({ isStoresAuthorised: () => false }));

const hubData = vi.hoisted(() => ({ useMyHubData: vi.fn() }));
vi.mock('../useMyHubData', () => ({ useMyHubData: hubData.useMyHubData }));

import { MyHub } from '../MyHub';
import type { AttendanceProfile } from '../api';

function baseSummary(overrides: Partial<{ inputRequestedCount: number; activeCount: number }> = {}) {
  return {
    openEntry: null, assignedVehicle: null, latestPayslip: null, latestReceipt: null,
    pendingCorrectionsCount: 0, recentEntryCount: 0,
    fleetIncidents: { inputRequestedCount: 0, activeCount: 0, ...overrides },
  };
}

function activeProfile(overrides: Partial<AttendanceProfile> = {}): AttendanceProfile {
  return {
    staffId: 's1', name: 'Driver One', phone: null, email: null, homeSiteId: null,
    hasAssignedVehicle: false, profilePhotoUrl: null, role: null, accountStatus: 'active', authRole: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hubData.useMyHubData.mockReturnValue({
    summary: baseSummary(), loadError: null, vehicleHandoffPending: false, vehicleHandoffError: null,
    hsCheckin: { completed: true, clearance: null }, hsCheckinUnavailable: false, canCrewCheckin: false,
    crewRecordedToday: null, handleVehicleTap: vi.fn(),
  });
});
afterEach(cleanup);

describe('MyHub — Fleet Incidents tile', () => {
  it('renames the vehicle group to "Fleet & vehicle"', () => {
    render(<MyHub profile={activeProfile()} />);
    expect(screen.getByText('Fleet & vehicle')).toBeVisible();
    expect(screen.queryByText('My vehicle')).not.toBeInTheDocument();
  });

  it('shows the Fleet Incidents tile for an active approved profile even without an assigned vehicle', () => {
    render(<MyHub profile={activeProfile({ hasAssignedVehicle: false })} />);
    expect(screen.getByText('Fleet incidents')).toBeVisible();
  });

  it('still hides the vehicle and parking tiles when the staff member has no assigned vehicle', () => {
    render(<MyHub profile={activeProfile({ hasAssignedVehicle: false })} />);
    expect(screen.queryByText('My Vehicle')).not.toBeInTheDocument();
    expect(screen.queryByText('Vehicle parking')).not.toBeInTheDocument();
  });

  it('shows the vehicle and parking tiles alongside Fleet Incidents when a vehicle IS assigned', () => {
    render(<MyHub profile={activeProfile({ hasAssignedVehicle: true })} />);
    expect(screen.getByText('My Vehicle')).toBeVisible();
    expect(screen.getByText('Vehicle parking')).toBeVisible();
    expect(screen.getByText('Fleet incidents')).toBeVisible();
  });

  it('shows the requested count before the active count in the tile subtitle', () => {
    hubData.useMyHubData.mockReturnValue({
      summary: baseSummary({ inputRequestedCount: 1, activeCount: 4 }), loadError: null,
      vehicleHandoffPending: false, vehicleHandoffError: null, hsCheckin: { completed: true, clearance: null },
      hsCheckinUnavailable: false, canCrewCheckin: false, crewRecordedToday: null, handleVehicleTap: vi.fn(),
    });
    render(<MyHub profile={activeProfile()} />);
    expect(screen.getByText(/1 input requested/i)).toBeVisible();
  });

  it('hides the whole "Fleet & vehicle" group (including Fleet Incidents) for a pending profile', () => {
    render(<MyHub profile={activeProfile({ accountStatus: 'pending' })} />);
    expect(screen.queryByText('Fleet & vehicle')).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet incidents')).not.toBeInTheDocument();
  });
});
