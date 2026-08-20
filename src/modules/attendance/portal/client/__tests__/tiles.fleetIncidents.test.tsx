/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FleetIncidentsTile } from '../tiles';
import type { HubSummaryResponse } from '../api';

afterEach(cleanup);

const BASE_SUMMARY: HubSummaryResponse = {
  openEntry: null, assignedVehicle: null, latestPayslip: null, latestReceipt: null,
  pendingCorrectionsCount: 0, recentEntryCount: 0,
  fleetIncidents: { inputRequestedCount: 0, activeCount: 0 },
};

describe('FleetIncidentsTile', () => {
  it('shows a loading placeholder while the summary has not loaded', () => {
    render(<FleetIncidentsTile summary={null} onClick={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeVisible();
  });

  it('shows "no incidents" copy when both counts are zero', () => {
    render(<FleetIncidentsTile summary={BASE_SUMMARY} onClick={vi.fn()} />);
    expect(screen.getByText(/no open incidents/i)).toBeVisible();
  });

  it('leads with the requested count, not the active count, when input has been requested', () => {
    const summary: HubSummaryResponse = { ...BASE_SUMMARY, fleetIncidents: { inputRequestedCount: 2, activeCount: 5 } };
    render(<FleetIncidentsTile summary={summary} onClick={vi.fn()} />);

    const subtitle = screen.getByText(/input requested/i);
    // The requested phrase must appear before any mention of the active count in the same subtitle text.
    expect(subtitle.textContent?.indexOf('2')).toBeLessThan(subtitle.textContent?.indexOf('5') ?? -1);
  });

  it('shows the active count alone when nothing is currently requested', () => {
    const summary: HubSummaryResponse = { ...BASE_SUMMARY, fleetIncidents: { inputRequestedCount: 0, activeCount: 3 } };
    render(<FleetIncidentsTile summary={summary} onClick={vi.fn()} />);
    expect(screen.getByText(/3 open/i)).toBeVisible();
    expect(screen.queryByText(/input requested/i)).not.toBeInTheDocument();
  });

  it('invokes onClick when tapped', () => {
    const onClick = vi.fn();
    render(<FleetIncidentsTile summary={BASE_SUMMARY} onClick={onClick} />);
    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
