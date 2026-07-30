import '@testing-library/jest-dom/vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePermission } from '@/hooks/usePermission';
import { useZoneDeliveryZone } from '../../hooks/useZoneDeliveryZone';
import { ZoneDeliveryWorkspacePage } from '../ZoneDeliveryWorkspacePage';
import { activityFixture, projectId, zoneFixture } from './zoneDeliveryWorkspaceFixture';

vi.mock('@/hooks/usePermission');
vi.mock('../../hooks/useZoneDeliveryZone');
const permissionMock = vi.mocked(usePermission);
const hookMock = vi.mocked(useZoneDeliveryZone);
const methods = {
  refresh: vi.fn(), updateScope: vi.fn().mockResolvedValue(true),
  confirmMilestone: vi.fn(), recordZoneQa: vi.fn(), uploadDocument: vi.fn(),
};
const state = (zone: typeof zoneFixture, conflict = false) => ({
  zone, activity: activityFixture, loading: false, refreshing: false, mutating: false,
  error: conflict ? 'Zone version is stale' : null,
  errorCode: conflict ? 'VERSION_CONFLICT' : null,
  lastUpdated: null, ...methods,
});

beforeEach(() => {
  Object.values(methods).forEach(method => method.mockClear());
  permissionMock.mockReturnValue({
    can: key => key === 'construction-qa.zone-delivery.scope-manage',
    canAny: vi.fn(), canAll: vi.fn(), canViewModule: vi.fn(), canAccessPage: vi.fn(),
    permissions: [], isLoading: false, refresh: vi.fn(),
  });
});

it('keeps an open scope draft but resyncs fresh server scope after conflict refresh and reopen', async () => {
  hookMock.mockReturnValue(state(zoneFixture, true));
  const { rerender } = render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage scope' }));
  fireEvent.change(screen.getByLabelText('Scope status PON 5'), { target: { value: 'included' } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh current zone' }));
  expect(methods.refresh).toHaveBeenCalledTimes(1);
  const fresh = {
    ...zoneFixture, rowVersion: 12,
    pons: zoneFixture.pons.map(pon => pon.ponNo === 5
      ? { ...pon, scopeStatus: 'cancelled' as const, rowVersion: 4 } : pon),
  };
  hookMock.mockReturnValue(state(fresh));
  rerender(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
  expect(screen.getByLabelText('Scope status PON 5')).toHaveValue('included');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage scope' }));
  expect(screen.getByLabelText('Scope status PON 5')).toHaveValue('cancelled');
  fireEvent.change(screen.getByLabelText('Scope reason PON 5'), { target: { value: 'Fresh decision' } });
  fireEvent.change(screen.getByLabelText('Scope reason PON 6'), { target: { value: 'Project cancellation' } });
  fireEvent.change(screen.getByLabelText('Effective date and time'), { target: { value: '2026-07-30T08:00' } });
  fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Refreshed schedule' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
  });
  expect(methods.updateScope).toHaveBeenCalledWith(expect.objectContaining({
    expectedRowVersion: 12,
    pons: expect.arrayContaining([
      expect.objectContaining({
        ponStageId: '44444444-4444-4444-8444-444444444444',
        scopeStatus: 'cancelled', reason: 'Fresh decision',
      }),
    ]),
  }));
});
