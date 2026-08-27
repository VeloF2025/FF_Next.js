/**
 * The day table.
 *
 * Three states have to be distinguishable at a glance and none may borrow another's rendering:
 * a complete day, a day observed below its own feed's standard, and a day that was never observed
 * at all. The last of those is a row the API never returned, so the table has to invent the ROW
 * without inventing the NUMBERS.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VehicleStatsTable from '../VehicleStatsTable';
import { MISSING_TEXT, UNMEASURABLE_TEXT } from '../statsDisplay';
import { cartrackDay, netstarDay } from './fixtures';

function renderTable(days = [cartrackDay(), netstarDay()]) {
  return render(
    <VehicleStatsTable days={days} endWorkDate="2026-08-22" startWorkDate="2026-08-19" />,
  );
}

describe('the missing day', () => {
  it('appears as its own row saying "No data", not as a row of zeros', () => {
    renderTable();
    const row = screen.getByTestId('stats-row-2026-08-19');
    expect(row).toHaveAttribute('data-coverage', 'missing');
    expect(within(row).getAllByText(MISSING_TEXT).length).toBeGreaterThan(0);
    // Not one digit anywhere but the date itself: a zero here is a claim nobody can support.
    const cells = within(row).getAllByRole('cell').slice(2);
    cells.forEach((cell) => expect(cell.textContent).not.toMatch(/\d/));
  });

  it('shows every day of the window, so a dead tracker cannot look like a short month', () => {
    renderTable();
    for (const date of ['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22']) {
      expect(screen.getByTestId(`stats-row-${date}`)).toBeVisible();
    }
  });
});

describe('the partial day', () => {
  it('is a state of its own, distinct from complete and from missing', () => {
    renderTable();
    expect(screen.getByTestId('stats-row-2026-08-21')).toHaveAttribute('data-coverage', 'partial');
    expect(screen.getByTestId('stats-row-2026-08-20')).toHaveAttribute('data-coverage', 'complete');
    const partial = screen.getByTestId('stats-row-2026-08-21');
    expect(within(partial).getByText('Partial')).toBeVisible();
  });

  it('renders coverage_complete = false with its real numbers, not as 0', () => {
    // A partial day is not an unmeasured day: distance and top speed are still real.
    renderTable([cartrackDay({ workDate: '2026-08-21', coverageComplete: false })]);
    const row = screen.getByTestId('stats-row-2026-08-21');
    expect(within(row).getByText('143.3 km')).toBeVisible();
    expect(within(row).getByText('7h 30m')).toBeVisible();
  });
});

describe('the unmeasurable cell', () => {
  it('is an em dash on a feed that does not assert ignition', () => {
    renderTable();
    const row = screen.getByTestId('stats-row-2026-08-21');
    const dashes = within(row).getAllByText(UNMEASURABLE_TEXT);
    // Ignition, moving, idle, speeding time, harsh and the ignition window — six columns this
    // feed cannot answer.
    expect(dashes).toHaveLength(6);
    dashes.forEach((cell) => {
      expect(cell).toBeVisible();
      expect(cell).toHaveAttribute('data-state', 'unmeasurable');
    });
    // And the two things it CAN answer are still there: distance, and the silence that explains
    // every dash beside it.
    expect(within(row).getByText('61.4 km')).toBeVisible();
    expect(within(row).getByText('2h 0m')).toBeVisible();
  });
});

describe('the day still in progress', () => {
  it('is its own labelled row above the window, never inside it', () => {
    render(
      <VehicleStatsTable
        days={[cartrackDay()]}
        endWorkDate="2026-08-22"
        startWorkDate="2026-08-19"
        today={{ workDate: '2026-08-23', stats: cartrackDay({
          workDate: '2026-08-23', coverageComplete: false, distanceKm: 12.5,
        }) }}
      />,
    );
    const row = screen.getByTestId('stats-row-today-2026-08-23');
    expect(row).toBeVisible();
    // Not judged as partial: coverage_complete is false because the day is not over, which says
    // nothing about the tracker.
    expect(row).toHaveAttribute('data-coverage', 'in_progress');
    expect(within(row).getByText('In progress')).toBeVisible();
    expect(within(row).getByText(/Today \(in progress\)/)).toBeVisible();
    expect(within(row).getByText('12.5 km')).toBeVisible();
    // And it is NOT one of the window's own rows.
    expect(screen.queryByTestId('stats-row-2026-08-23')).toBeNull();
  });

  it('is absent when the caller asked a historical question', () => {
    render(
      <VehicleStatsTable days={[cartrackDay()]} endWorkDate="2026-08-22" startWorkDate="2026-08-19" />,
    );
    expect(screen.queryByText(/Today \(in progress\)/)).toBeNull();
  });

  it('shows today with no row yet as "No data", not as zeros', () => {
    render(
      <VehicleStatsTable
        days={[]}
        endWorkDate="2026-08-22"
        startWorkDate="2026-08-22"
        today={{ workDate: '2026-08-23', stats: null }}
      />,
    );
    const row = screen.getByTestId('stats-row-today-2026-08-23');
    within(row).getAllByRole('cell').slice(2).forEach((cell) => {
      expect(cell.textContent).not.toMatch(/\d/);
    });
  });
});

describe('the observation columns', () => {
  it('names the duration column "Speeding time", not "Speeding"', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: 'Speeding time' })).toBeVisible();
  });

  it('shows the longest silence and the ignition window with their caveats', () => {
    renderTable([cartrackDay()]);
    const row = screen.getByTestId('stats-row-2026-08-20');
    expect(within(row).getByText('8m')).toBeVisible();
    expect(within(row).getByText('06:10–17:00')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Longest silence' }))
      .toHaveAttribute('title', expect.stringContaining('LARGEST unobserved stretch'));
    expect(screen.getByRole('columnheader', { name: 'Ignition window' }))
      .toHaveAttribute('title', expect.stringContaining('Not a duration'));
  });
});

describe('day selection', () => {
  it('reports the clicked day to the caller', () => {
    const onSelectDate = vi.fn();
    render(
      <VehicleStatsTable
        days={[cartrackDay()]}
        endWorkDate="2026-08-22"
        onSelectDate={onSelectDate}
        startWorkDate="2026-08-19"
      />,
    );
    fireEvent.click(screen.getByTestId('stats-row-2026-08-20'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-08-20');
  });
});

describe('the "Moving 0m" oddity — kilometres beside zero moving time', () => {
  it('shows an em dash with the attribution title, never a visible "Moving 0m"', () => {
    renderTable([cartrackDay({ workDate: '2026-08-20', movingSeconds: 0, distanceKm: 12.4 })]);
    const row = screen.getByTestId('stats-row-2026-08-20');
    expect(within(row).getByText('12.4 km')).toBeVisible();
    const dash = within(row).getByTitle(
      /distance was recorded, but none of the day could be attributed to moving/,
    );
    expect(dash).toBeVisible();
    expect(dash.textContent).toBe(UNMEASURABLE_TEXT);
    expect(within(row).queryByText('0m')).toBeNull();
  });
});
