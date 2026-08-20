import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AttendanceProfile } from '../api';

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('../MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../InstallPrompt', () => ({
  InstallPrompt: () => null,
}));

const hookState = vi.hoisted(() => ({
  data: {
    summary: null as { openEntry: { id: string; clockInAt: string; durationMs: number } | null } | null,
    loadError: null,
    vehicleHandoffPending: false,
    vehicleHandoffError: null,
    hsCheckin: null as { completed: boolean; clearance: string | null } | null,
    hsCheckinUnavailable: false,
    canCrewCheckin: false,
    crewRecordedToday: null,
    handleVehicleTap: vi.fn(),
  },
}));

vi.mock('../useMyHubData', () => ({
  useMyHubData: () => hookState.data,
}));

import { MyHub } from '../MyHub';

const OUTSTANDING_PATTERN = /still to do|outstanding/i;

const profile: AttendanceProfile = {
  staffId: 'staff-1',
  name: 'Test Worker',
  phone: null,
  email: null,
  homeSiteId: null,
  hasAssignedVehicle: false,
  profilePhotoUrl: null,
  role: null,
  accountStatus: 'active',
  authRole: null,
};

const OPEN_ENTRY = { id: 'entry-1', clockInAt: new Date().toISOString(), durationMs: 0 };

describe('MyHub — H&S tile outstanding badge', () => {
  it('marks the H&S tile outstanding when clocked in with no check-in today', () => {
    hookState.data.summary = { openEntry: OPEN_ENTRY };
    hookState.data.hsCheckin = { completed: false, clearance: null };

    render(<MyHub profile={profile} />);

    expect(screen.getAllByText(OUTSTANDING_PATTERN).length).toBeGreaterThan(0);
  });

  it('does not mark it when the check-in is done', () => {
    hookState.data.summary = { openEntry: OPEN_ENTRY };
    hookState.data.hsCheckin = { completed: true, clearance: 'cleared' };

    render(<MyHub profile={profile} />);

    expect(screen.queryAllByText(OUTSTANDING_PATTERN)).toHaveLength(0);
  });

  it('does not mark it when the worker is not clocked in', () => {
    hookState.data.summary = { openEntry: null };
    hookState.data.hsCheckin = { completed: false, clearance: null };

    render(<MyHub profile={profile} />);

    expect(screen.queryAllByText(OUTSTANDING_PATTERN)).toHaveLength(0);
  });
});
