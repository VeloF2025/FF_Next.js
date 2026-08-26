/**
 * The summary cards, judged on what a reader can SEE.
 *
 * `getByText` passes for text that is present but invisible, so every assertion here is
 * `toBeVisible`, and the unmeasurable cases additionally assert that no zero was rendered in that
 * card — the defect being guarded is a plausible number, not a missing one.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import VehicleStatsCards from '../VehicleStatsCards';
import { UNMEASURABLE_TEXT, UNMEASURABLE_TITLE } from '../statsDisplay';
import { cartrackDay, netstarDay } from './fixtures';

const fullCoverage = {
  firstPositionWorkDate: '2026-01-01', daysWithData: 30, daysExpected: 30,
  daysPartial: 0,
};

function card(label: string) {
  return screen.getByTestId(`stat-value-${label}`);
}

describe('a feed that can measure ignition', () => {
  it('shows real totals', () => {
    render(
      <VehicleStatsCards
        coverage={fullCoverage}
        days={[cartrackDay(), cartrackDay({ workDate: '2026-08-21' })]}
        windowDays={30}
      />,
    );
    expect(card('ignition-time')).toBeVisible();
    expect(card('ignition-time')).toHaveTextContent('15h 0m');
    expect(card('distance')).toHaveTextContent('286.5 km');
    expect(card('days-observed')).toHaveTextContent('30 / 30');
  });
});

describe('a feed that cannot', () => {
  it('renders ignition, moving and idle as an em dash — never as 0', () => {
    render(
      <VehicleStatsCards
        coverage={{ ...fullCoverage, daysPartial: 30 }}
        days={[netstarDay(), netstarDay({ workDate: '2026-08-22' })]}
        windowDays={30}
      />,
    );
    for (const label of ['ignition-time', 'moving-time', 'idle-time']) {
      expect(card(label)).toBeVisible();
      expect(card(label)).toHaveTextContent(UNMEASURABLE_TEXT);
      // The whole point. "0m" here is a confident claim that the vehicle never ran.
      expect(card(label).textContent).not.toMatch(/\d/);
      expect(card(label)).toHaveAttribute('title', UNMEASURABLE_TITLE);
    }
  });

  it('still shows the distance that feed CAN report', () => {
    render(
      <VehicleStatsCards coverage={fullCoverage} days={[netstarDay()]} windowDays={30} />,
    );
    expect(card('distance')).toHaveTextContent('61.4 km');
  });

  it('renders harsh driving as unmeasurable with neither g-force nor provider events', () => {
    render(<VehicleStatsCards coverage={fullCoverage} days={[netstarDay()]} windowDays={30} />);
    expect(card('harsh-driving')).toHaveTextContent(UNMEASURABLE_TEXT);
    expect(card('harsh-driving').textContent).not.toMatch(/\d/);
  });
});

describe('the empty window', () => {
  it('says nothing was observed rather than showing a fleet of zeros', () => {
    render(
      <VehicleStatsCards
        coverage={{
          firstPositionWorkDate: null, daysWithData: 0, daysExpected: 0,
          daysPartial: 0,
        }}
        days={[]}
        windowDays={30}
      />,
    );
    expect(card('days-observed')).toHaveTextContent('Never observed');
    expect(card('distance')).toHaveTextContent(UNMEASURABLE_TEXT);
    expect(card('distance').textContent).not.toMatch(/\d/);
  });
});

describe('the partial-coverage window', () => {
  it('counts partial days separately and shows how many days a total came from', () => {
    render(
      <VehicleStatsCards
        coverage={{ ...fullCoverage, daysWithData: 12, daysPartial: 8 }}
        days={[cartrackDay(), netstarDay(), netstarDay({ workDate: '2026-08-23' })]}
        windowDays={30}
      />,
    );
    expect(card('partial-days')).toHaveTextContent('8');
    // A 30-day card built from one measurable day must say so.
    const cards = screen.getByTestId('vehicle-stats-cards');
    // Ignition, moving and idle each carry it.
    const measurable = within(cards).getAllByText('1 of 3 days measurable');
    expect(measurable).toHaveLength(3);
    measurable.forEach((node) => expect(node).toBeVisible());
    expect(card('days-observed')).toHaveTextContent('12 / 30');
  });
});
