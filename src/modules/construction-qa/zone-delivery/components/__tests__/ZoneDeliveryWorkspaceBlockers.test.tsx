import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermission } from '@/hooks/usePermission';
import { useZoneDeliveryZone } from '../../hooks/useZoneDeliveryZone';
import { ZoneDeliveryWorkspacePage } from '../ZoneDeliveryWorkspacePage';
import { activityFixture, ponStageId, projectId, zoneFixture } from './zoneDeliveryWorkspaceFixture';

vi.mock('@/hooks/usePermission');
vi.mock('../../hooks/useZoneDeliveryZone');
const permissionMock = vi.mocked(usePermission);
const hookMock = vi.mocked(useZoneDeliveryZone);
const methods = {
  refresh: vi.fn(), updateScope: vi.fn(), confirmMilestone: vi.fn(),
  recordZoneQa: vi.fn(), uploadDocument: vi.fn(),
};
const setZone = (zone = zoneFixture) => hookMock.mockReturnValue({
  zone, activity: activityFixture, loading: false, refreshing: false,
  mutating: false, error: null, errorCode: null, lastUpdated: null, ...methods,
});

beforeEach(() => {
  permissionMock.mockReturnValue({
    can: () => true, canAny: vi.fn(), canAll: vi.fn(), canViewModule: vi.fn(),
    canAccessPage: vi.fn(), permissions: [], isLoading: false, refresh: vi.fn(),
  });
  setZone();
});

describe('authoritative server blockers', () => {
  it('enables only the server-named missing PON gate and disables later gates with exact copy', () => {
    setZone({
      ...zoneFixture,
      status: 'testing_in_progress',
      pons: [{ ...zoneFixture.pons[0]!, milestones: {
        civil_complete: zoneFixture.pons[0]!.milestones.civil_complete,
        optical_complete: zoneFixture.pons[0]!.milestones.optical_complete,
      } }],
      blockers: [{
        code: 'PON_TESTING_INCOMPLETE', message: 'PON 4 testing is not passed',
        ponNo: 4, entityId: ponStageId,
      }],
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('button', { name: 'Confirm Testing passed for PON 4' })).toBeEnabled();
    const later = screen.getByRole('button', { name: 'Confirm Port submitted for PON 4' });
    expect(later).toBeDisabled();
    expect(later).toHaveAttribute('title', 'PON 4 testing is not passed');
    expect(later).toHaveAccessibleDescription('PON 4 testing is not passed');
  });

  it('applies the exact scope blocker to every included-PON confirmation', () => {
    setZone({
      ...zoneFixture, status: 'scope_pending',
      pons: [{ ...zoneFixture.pons[0]!, milestones: {} }],
      blockers: [{ code: 'SCOPE_NOT_APPROVED', message: 'Zone scope is not approved' }],
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    const civil = screen.getByRole('button', { name: 'Confirm Civil complete for PON 4' });
    expect(civil).toBeDisabled();
    expect(civil).toHaveAccessibleDescription('Zone scope is not approved');
  });

  it('hides milestones for exception PONs and scopes Snags links to snag blockers', () => {
    const { unmount } = render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.queryByRole('button', { name: /for PON 5/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open in Snags' })).toHaveLength(1);
    unmount();
    setZone({
      ...zoneFixture,
      blockers: [{ code: 'FAC_MISSING', message: 'Active FAC is missing' }],
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.queryByRole('link', { name: 'Open in Snags' })).not.toBeInTheDocument();
  });

  it('disables QA outside authoritative QA statuses using exact blocker copy', () => {
    setZone({
      ...zoneFixture, status: 'testing_in_progress',
      blockers: [{ code: 'PON_TESTING_INCOMPLETE', message: 'PON 4 testing is not passed', entityId: ponStageId }],
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    const qa = screen.getByRole('button', { name: 'Record Civil Zone QA' });
    expect(qa).toBeDisabled();
    expect(qa).toHaveAccessibleDescription('PON 4 testing is not passed');
  });
});
