/**
 * The fleet-wide day table.
 *
 * The line worth reading is the vehicle that reported NOTHING, so the two things guarded here are
 * that it survives into the table at all and that it carries no numbers when it does.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import FleetStatsOverview from '../FleetStatsOverview';
import { MISSING_TEXT, UNMEASURABLE_TEXT } from '../statsDisplay';
import { cartrackDay, netstarDay } from './fixtures';
import type { FleetOverviewResult } from '../vehicleStatsApi';

function result(overrides: Partial<FleetOverviewResult> = {}): FleetOverviewResult {
  return {
    workDate: '2026-08-24',
    vehicles: [
      { vehicleId: 'v1', registration: 'AAA 111 GP', make: null, model: null, status: 'active',
        stats: null },
      { vehicleId: 'v2', registration: 'BBB 222 GP', make: null, model: null, status: 'active',
        stats: cartrackDay({ workDate: '2026-08-24' }) },
      { vehicleId: 'v3', registration: 'CCC 333 GP', make: null, model: null, status: 'active',
        stats: netstarDay({ workDate: '2026-08-24' }) },
    ],
    coverage: { trackedVehicles: 3, vehiclesWithData: 2, vehiclesPartial: 1 },
    ...overrides,
  };
}

describe('the vehicle that did not report', () => {
  it('stays in the table as "No data", with no numbers', () => {
    render(<FleetStatsOverview result={result()} />);
    const row = screen.getByTestId('overview-row-v1');
    expect(row).toBeVisible();
    expect(row).toHaveAttribute('data-coverage', 'missing');
    const cells = within(row).getAllByRole('cell').slice(2);
    cells.forEach((cell) => {
      expect(cell).toHaveTextContent(MISSING_TEXT);
      expect(cell.textContent).not.toMatch(/\d/);
    });
  });

  it('is counted in a coverage line rather than left to be inferred', () => {
    render(<FleetStatsOverview result={result()} />);
    expect(screen.getByText(/2 of 3 tracked vehicles reported on 2026-08-24/)).toBeVisible();
    expect(screen.getByText(/1 only partially/)).toBeVisible();
  });
});

describe('per-feed honesty', () => {
  it('shows an em dash for a snapshot feed’s ignition time, never 0', () => {
    render(<FleetStatsOverview result={result()} />);
    const row = screen.getByTestId('overview-row-v3');
    expect(row).toHaveAttribute('data-coverage', 'partial');
    const dashes = within(row).getAllByText(UNMEASURABLE_TEXT);
    expect(dashes).toHaveLength(2); // ignition and moving
    dashes.forEach((cell) => expect(cell).toBeVisible());
    expect(within(row).getByText('61.4 km')).toBeVisible();
  });

  it('shows real numbers for a feed that can measure them', () => {
    render(<FleetStatsOverview result={result()} />);
    const row = screen.getByTestId('overview-row-v2');
    expect(within(row).getByText('7h 30m')).toBeVisible();
    expect(within(row).getByText('Complete')).toBeVisible();
  });
});

describe('column naming', () => {
  it('names the count column "Speeding events" — it is a count, not a duration', () => {
    render(<FleetStatsOverview result={result()} />);
    expect(screen.getByRole('columnheader', { name: 'Speeding events' })).toBeVisible();
  });
});

describe('the empty fleet', () => {
  it('says no vehicle carries a tracker instead of showing an empty grid', () => {
    render(<FleetStatsOverview result={result({
      vehicles: [], coverage: { trackedVehicles: 0, vehiclesWithData: 0, vehiclesPartial: 0 },
    })} />);
    expect(screen.getByText(/No active vehicle carries a tracker/)).toBeVisible();
  });
});
