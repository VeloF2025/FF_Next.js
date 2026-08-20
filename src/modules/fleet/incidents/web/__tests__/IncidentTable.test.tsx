/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IncidentTable } from '../IncidentTable';
import type { IncidentListItem } from '../../types';

function incident(overrides: Partial<IncidentListItem> = {}): IncidentListItem {
  return {
    id: 'incident-1', incidentReference: 'FL-0001', incidentType: 'late', severity: 'high', lifecycleStatus: 'open',
    staffId: 'staff-1', staffName: 'Jane Driver', projectId: 'project-1', projectName: 'Lawley',
    operationalSiteName: 'Zone A', openedAt: '2026-08-18T07:00:00.000Z', conditionLastSeenAt: '2026-08-18T07:55:00.000Z',
    conditionClearedAt: null, escalationLevel: 0, nextEscalationAt: '2026-08-18T08:15:00.000Z', evidenceCount: 0,
    driverInput: { state: 'not_requested', respondBy: null, deliveryFailed: false },
    ...overrides,
  };
}

/**
 * PR7 review I4: the queue previously had no driver-input surface at all — a manager could
 * only discover a driver's response by opening each incident individually. This proves the
 * new "Driver input" column renders the server-computed `driverInput.state` per row, and
 * that a plain, unrequested incident shows no misleading text.
 */
describe('IncidentTable driver-input column', () => {
  it('renders a dash for an incident where driver input was never requested', () => {
    render(<IncidentTable incidents={[incident()]} canEdit={false} selected={new Set()} onToggleSelect={vi.fn()} onOpen={vi.fn()} />);
    const row = screen.getByTestId('incident-row-incident-1');
    expect(within(row).getByText('—')).toBeInTheDocument();
  });

  it('renders distinct labels for requested, responded, expired, and closed driver-input states', () => {
    const incidents = [
      incident({ id: 'i-requested', driverInput: { state: 'requested', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false } }),
      incident({ id: 'i-responded', driverInput: { state: 'responded', respondBy: '2026-08-20T21:59:59.999Z', deliveryFailed: false } }),
      incident({ id: 'i-expired', driverInput: { state: 'expired', respondBy: '2026-08-15T21:59:59.999Z', deliveryFailed: false } }),
      incident({ id: 'i-closed', driverInput: { state: 'closed', respondBy: null, deliveryFailed: false } }),
    ];
    render(<IncidentTable incidents={incidents} canEdit={false} selected={new Set()} onToggleSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(within(screen.getByTestId('incident-row-i-requested')).getByText('Awaiting driver')).toBeInTheDocument();
    expect(within(screen.getByTestId('incident-row-i-responded')).getByText('Driver responded')).toBeInTheDocument();
    expect(within(screen.getByTestId('incident-row-i-expired')).getByText('Response expired')).toBeInTheDocument();
    expect(within(screen.getByTestId('incident-row-i-closed')).getByText('Response closed')).toBeInTheDocument();
  });

  it('does not render a driver-input filter control — only a read-only indicator per row', () => {
    render(<IncidentTable incidents={[incident()]} canEdit={false} selected={new Set()} onToggleSelect={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: /driver input/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/driver input/i)).not.toBeInTheDocument();
  });
});
