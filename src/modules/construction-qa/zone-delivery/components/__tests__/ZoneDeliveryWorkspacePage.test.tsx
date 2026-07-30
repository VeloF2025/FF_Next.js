import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermission } from '@/hooks/usePermission';
import { useZoneDeliveryZone } from '../../hooks/useZoneDeliveryZone';
import { ZoneDeliveryWorkspacePage } from '../ZoneDeliveryWorkspacePage';
import {
  activityFixture,
  projectId,
  zoneFixture,
} from './zoneDeliveryWorkspaceFixture';

vi.mock('@/hooks/usePermission');
vi.mock('../../hooks/useZoneDeliveryZone');
const permissionMock = vi.mocked(usePermission);
const hookMock = vi.mocked(useZoneDeliveryZone);

const allPermissions = new Set([
  'construction-qa.zone-delivery.scope-manage',
  'construction-qa.zone-delivery.construction-confirm',
  'construction-qa.zone-delivery.testing-confirm',
  'construction-qa.zone-delivery.operations-confirm',
  'construction-qa.zone-delivery.zone-qa-approve',
  'construction-qa.zone-delivery.documents-manage',
]);

beforeEach(() => {
  permissionMock.mockReturnValue({
    can: (key) => allPermissions.has(key),
    canAny: vi.fn(), canAll: vi.fn(), canViewModule: vi.fn(), canAccessPage: vi.fn(),
    permissions: [], isLoading: false, refresh: vi.fn(),
  });
  hookMock.mockReturnValue({
    zone: zoneFixture,
    activity: activityFixture,
    loading: false,
    refreshing: false,
    mutating: false,
    error: null,
    errorCode: null,
    lastUpdated: new Date('2026-07-30T09:00:00.000Z'),
    refresh: vi.fn(),
    updateScope: vi.fn(),
    confirmMilestone: vi.fn(),
    recordZoneQa: vi.fn(),
    uploadDocument: vi.fn(),
  });
});

describe('ZoneDeliveryWorkspacePage projection', () => {
  it('renders server identity, counts, status, eligibility and exact blockers', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('link', { name: 'Back to zone register' })).toHaveAttribute('href', '/field-ops');
    expect(screen.getByRole('heading', { name: 'Etwatwa Zone 12' })).toBeInTheDocument();
    expect(screen.getByText('1 / 1 technically live')).toBeInTheDocument();
    expect(screen.getByText('Handover blocked')).toBeInTheDocument();
    expect(screen.getByLabelText('Eligible for Zone QA time')).toHaveAttribute(
      'datetime', '2026-07-06T08:00:00.000Z');
    expect(screen.getByText('1 open handover-blocking snag(s)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Snags' })).toHaveAttribute(
      'href',
      `/field-ops/snags?project_id=${projectId}&zone_no=12&pon_no=4`,
    );
  });

  it('shows query-preserving module links and all ordered lifecycle gates', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('link', { name: 'Works QA' })).toHaveAttribute(
      'href', `/field-ops/works-qa?project_id=${projectId}&zone_no=12`);
    expect(screen.getByRole('link', { name: 'OTDR' })).toHaveAttribute(
      'href', `/field-ops/otdr?project_id=${projectId}&zone_no=12`);
    expect(screen.getByRole('link', { name: 'Snags' })).toHaveAttribute(
      'href', `/field-ops/snags?project_id=${projectId}&zone_no=12`);
    const labels = screen.getAllByTestId('lifecycle-gate').map(node => node.textContent);
    expect(labels).toEqual([
      'Civil complete', 'Optical complete', 'Testing passed',
      'Port submitted', 'Port approved', 'Technically live',
    ]);
  });

  it('shows each milestone evidence and explicit excluded/cancelled scope', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('row', { name: /PON 4 Included/ })).toHaveTextContent('Operations confirmation');
    expect(screen.getByRole('row', { name: /PON 5 Excluded/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /PON 6 Cancelled/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PON 4 Works QA' })).toHaveAttribute(
      'href', `/field-ops/works-qa?project_id=${projectId}&zone_no=12&pon_no=4`);
    expect(screen.getByRole('link', { name: 'PON 4 OTDR' })).toHaveAttribute(
      'href', `/field-ops/otdr?project_id=${projectId}&zone_no=12&pon_no=4`);
  });

  it('keeps civil and optical QA separate and displays both active certificates', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    expect(screen.getByRole('region', { name: 'Civil Zone QA' })).toHaveTextContent('Passed');
    expect(screen.getByRole('region', { name: 'Optical Zone QA' })).toHaveTextContent('Failed');
    expect(screen.getByRole('link', { name: 'Active FAC' })).toHaveAttribute('href', '/storage/fac.pdf');
    expect(screen.getByRole('link', { name: 'Active CAC' })).toHaveAttribute('href', '/storage/cac.pdf');
    expect(screen.getByText(`SHA-256: ${'a'.repeat(64)}`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Active test pack for PON 4' })).toBeInTheDocument();
  });

  it('shows readable audit old/new values and effective versus recorded time', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    const item = screen.getByRole('listitem', { name: 'scope_updated' });
    const effective = screen.getByLabelText('scope_updated effective time');
    const recorded = screen.getByLabelText('scope_updated recorded time');
    expect(effective).toHaveAttribute('datetime', '2026-06-30T10:00:00.000Z');
    expect(recorded).toHaveAttribute('datetime', '2026-07-01T12:00:00.000Z');
    expect(effective.textContent).not.toBe(recorded.textContent);
    expect(item).toHaveTextContent('manager@example.com');
    expect(item).toHaveTextContent('construction-qa.zone-delivery.scope-manage');
    expect(item).toHaveTextContent('Approved construction schedule');
    expect(item).toHaveTextContent('Historical backfill');
    expect(item).toHaveTextContent('"scopeStatus": "included"');
    expect(item).toHaveTextContent('"scopeStatus": "excluded"');
  });

  it('retains exact milestone and QA timestamps while displaying timezone-aware times', () => {
    render(<ZoneDeliveryWorkspacePage zoneKey={{ projectId, zoneNo: 12 }} />);
    const milestone = screen.getByLabelText('PON 4 Civil complete effective time');
    const qa = screen.getByLabelText('Civil Zone QA effective time');
    expect(milestone).toHaveAttribute('datetime', '2026-07-01T08:00:00.000Z');
    expect(qa).toHaveAttribute('datetime', '2026-07-07T08:00:00.000Z');
    expect(milestone.textContent).toMatch(/08:00|10:00/);
    expect(qa.textContent).toMatch(/08:00|10:00/);
    expect(milestone.textContent).toMatch(/GMT|UTC|SAST/i);
  });
});
