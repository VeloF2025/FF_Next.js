import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermission } from '@/hooks/usePermission';
import { useZoneDeliveryZone } from '../../hooks/useZoneDeliveryZone';
import { ZoneDeliveryWorkspacePage } from '../ZoneDeliveryWorkspacePage';
import {
  activityFixture,
  ponStageId,
  projectId,
  snagId,
  zoneFixture,
} from './zoneDeliveryWorkspaceFixture';

vi.mock('@/hooks/usePermission');
vi.mock('../../hooks/useZoneDeliveryZone');
const permissionMock = vi.mocked(usePermission);
const hookMock = vi.mocked(useZoneDeliveryZone);
const methods = {
  refresh: vi.fn(), updateScope: vi.fn(), confirmMilestone: vi.fn(),
  recordZoneQa: vi.fn(), uploadDocument: vi.fn(),
};
const setPermissions = (allowed: string[]) => {
  permissionMock.mockReturnValue({
    can: key => allowed.includes(key),
    canAny: vi.fn(), canAll: vi.fn(), canViewModule: vi.fn(), canAccessPage: vi.fn(),
    permissions: [], isLoading: false, refresh: vi.fn(),
  });
};

beforeEach(() => {
  Object.values(methods).forEach(method => method.mockReset().mockResolvedValue(true));
  hookMock.mockReturnValue({
    zone: zoneFixture, activity: activityFixture,
    loading: false, refreshing: false, mutating: false,
    error: null, errorCode: null, lastUpdated: null, ...methods,
  });
  setPermissions([]);
});

describe('ZoneDeliveryWorkspacePage permissions', () => {
  it.each([
    ['construction-qa.zone-delivery.scope-manage', 'Manage scope'],
    ['construction-qa.zone-delivery.construction-confirm', 'Reopen Civil complete for PON 4'],
    ['construction-qa.zone-delivery.testing-confirm', 'Reopen Testing passed for PON 4'],
    ['construction-qa.zone-delivery.operations-confirm', 'Reopen Port submitted for PON 4'],
    ['construction-qa.zone-delivery.zone-qa-approve', 'Record Civil Zone QA'],
    ['construction-qa.zone-delivery.documents-manage', 'Upload evidence'],
  ])('shows %s controls only with its exact edit permission', (permission, actionName) => {
    const { rerender } = render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.queryByRole('button', { name: actionName })).not.toBeInTheDocument();
    setPermissions([permission]);
    rerender(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('button', { name: actionName })).toBeInTheDocument();
  });

  it('hides delivery edits after handover but retains operations maintenance linking', () => {
    setPermissions([
      'construction-qa.zone-delivery.scope-manage',
      'construction-qa.zone-delivery.construction-confirm',
      'construction-qa.zone-delivery.operations-confirm',
    ]);
    hookMock.mockReturnValue({
      ...hookMock(), ...methods,
      zone: { ...zoneFixture, status: 'handed_over', handedOverAt: '2026-07-30T10:00:00.000Z' },
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.queryByRole('button', { name: 'Manage scope' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen Civil complete for PON 4' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link maintenance issue for PON 4' })).toBeInTheDocument();
  });

  it('does not show maintenance linking before handover', () => {
    setPermissions(['construction-qa.zone-delivery.operations-confirm']);
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.queryByRole('button', { name: /Link maintenance issue/ })).not.toBeInTheDocument();
  });
});

describe('ZoneDeliveryWorkspacePage audited dialogs', () => {
  it('submits the complete scope and requires reasons only for exception rows', async () => {
    setPermissions(['construction-qa.zone-delivery.scope-manage']);
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage scope' }));
    fireEvent.change(screen.getByLabelText('Scope reason PON 5'), {
      target: { value: 'Wayleave withdrawn' },
    });
    fireEvent.change(screen.getByLabelText('Scope reason PON 6'), {
      target: { value: 'Project cancellation' },
    });
    fireEvent.change(screen.getByLabelText('Effective date and time'), {
      target: { value: '2026-07-30T08:00' },
    });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Approved schedule' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    expect(methods.updateScope).toHaveBeenCalledWith({
      expectedRowVersion: 11,
      effectiveAt: '2026-07-30T08:00',
      source: 'Approved schedule',
      pons: [
        { ponStageId, scopeStatus: 'included' },
        {
          ponStageId: '44444444-4444-4444-8444-444444444444',
          scopeStatus: 'excluded', reason: 'Wayleave withdrawn',
        },
        {
          ponStageId: '55555555-5555-4555-8555-555555555555',
          scopeStatus: 'cancelled', reason: 'Project cancellation',
        },
      ],
    });
  });

  it('requires source/effective time/reason and sends the PON row version for reopen', async () => {
    setPermissions(['construction-qa.zone-delivery.testing-confirm']);
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Testing passed for PON 4' }));
    fireEvent.change(screen.getByLabelText('Effective date and time'), {
      target: { value: '2026-07-30T08:00' },
    });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Supervisor review' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Incorrect original test' } });
    fireEvent.change(screen.getByLabelText('Snag ID'), { target: { value: snagId } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    await waitFor(() => expect(methods.confirmMilestone).toHaveBeenCalledWith({
      ponStageId, milestone: 'testing_passed', action: 'reopen',
      snagId, affectedGate: 'testing_passed',
      expectedRowVersion: 7, effectiveAt: '2026-07-30T08:00',
      source: 'Supervisor review', reason: 'Incorrect original test',
    }));
  });

  it('sends the post-handover maintenance snag, gate and PON row version', async () => {
    setPermissions(['construction-qa.zone-delivery.operations-confirm']);
    hookMock.mockReturnValue({
      ...hookMock(), ...methods,
      zone: { ...zoneFixture, status: 'handed_over', handedOverAt: '2026-07-30T10:00:00.000Z' },
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Link maintenance issue for PON 4' }));
    fireEvent.change(screen.getByLabelText('Snag ID'), { target: { value: snagId } });
    fireEvent.change(screen.getByLabelText('Affected gate'), { target: { value: 'optical_complete' } });
    fireEvent.change(screen.getByLabelText('Effective date and time'), { target: { value: '2026-07-30T08:00' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Maintenance inspection' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Post-handover defect' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    expect(methods.confirmMilestone).toHaveBeenCalledWith({
      ponStageId, milestone: 'optical_complete', action: 'link_maintenance',
      snagId, affectedGate: 'optical_complete', expectedRowVersion: 7,
      effectiveAt: '2026-07-30T08:00', source: 'Maintenance inspection',
      reason: 'Post-handover defect',
    });
  });

  it('requires a snag for failed QA and sends the zone row version', async () => {
    setPermissions(['construction-qa.zone-delivery.zone-qa-approve']);
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Record Optical Zone QA' }));
    fireEvent.change(screen.getByLabelText('QA status'), { target: { value: 'failed' } });
    fireEvent.change(screen.getByLabelText('Snag IDs'), { target: { value: snagId } });
    fireEvent.change(screen.getByLabelText('QA notes'), { target: { value: 'Repair needed' } });
    fireEvent.change(screen.getByLabelText('Effective date and time'), {
      target: { value: '2026-07-30T08:00' },
    });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Zone inspection' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    await waitFor(() => expect(methods.recordZoneQa).toHaveBeenCalledWith({
      discipline: 'optical', status: 'failed', snagIds: [snagId],
      notes: 'Repair needed', expectedRowVersion: 11,
      effectiveAt: '2026-07-30T08:00', source: 'Zone inspection',
    }));
  });

  it('shows command conflicts with a user-invoked refresh and never retries automatically', () => {
    hookMock.mockReturnValue({
      ...hookMock(), ...methods,
      error: 'Zone version is stale', errorCode: 'VERSION_CONFLICT',
    });
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Zone version is stale');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current zone' }));
    expect(methods.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog and audit values after a failed command', async () => {
    methods.confirmMilestone.mockResolvedValueOnce(false);
    setPermissions(['construction-qa.zone-delivery.testing-confirm']);
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Testing passed for PON 4' }));
    fireEvent.change(screen.getByLabelText('Snag ID'), { target: { value: snagId } });
    fireEvent.change(screen.getByLabelText('Effective date and time'), { target: { value: '2026-07-30T08:00' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Supervisor review' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Incorrect original test' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit audited action' }));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Snag ID')).toHaveValue(snagId);
    expect(screen.getByLabelText('Source')).toHaveValue('Supervisor review');
    expect(screen.getByLabelText('Reason')).toHaveValue('Incorrect original test');
  });
});
