/**
 * The day route.
 *
 * A route is the most believable thing on the stats page, and its two failure modes both look
 * like an ordinary journey: a trip closed by tracker SILENCE ends where the signal died rather
 * than where the vehicle stopped, and a line drawn between two endpoints is not the road that was
 * driven. Both must be visible, not inferable.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetMapProps } from '../../../components/FleetMap';
import VehicleDayRouteMap from '../VehicleDayRouteMap';
import type { DayRoutePosition, DayRouteTrip } from '../vehicleStatsApi';

const mapMocks = vi.hoisted(() => ({ props: vi.fn() }));
vi.mock('next/dynamic', () => ({
  default: () => (props: FleetMapProps) => {
    mapMocks.props(props);
    return <div data-testid="fleet-map">route legs: {props.dayRoute?.length ?? 0}</div>;
  },
}));

function trip(overrides: Partial<DayRouteTrip> = {}): DayRouteTrip {
  return {
    id: 't1',
    ignitionOnAt: '2026-08-20T06:00:00.000Z',
    ignitionOffAt: '2026-08-20T07:00:00.000Z',
    closeReason: 'ignition_off',
    countsTowardMetrics: true,
    start: { lat: -26.2, lon: 28.0, place: 'Depot' },
    end: { lat: -26.1, lon: 28.1, place: null },
    durationSeconds: 3600, distanceKm: 10.5, maxSpeedKph: 95,
    ...overrides,
  };
}

function position(at: string, lat: number, lon: number): DayRoutePosition {
  return { recordedAt: at, lat, lon, speedKph: 60, ignition: true };
}

function renderMap(props: Partial<React.ComponentProps<typeof VehicleDayRouteMap>> = {}) {
  return render(
    <VehicleDayRouteMap
      allTripsTimedOut={false}
      positions={null}
      timedOutTrips={0}
      trips={[trip()]}
      workDate="2026-08-20"
      {...props}
    />,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('a day whose trips all timed out', () => {
  it('says so above the map rather than drawing a confident route', () => {
    renderMap({
      allTripsTimedOut: true, timedOutTrips: 2,
      trips: [trip({ closeReason: 'timeout', countsTowardMetrics: false }),
              trip({ id: 't2', closeReason: 'timeout', countsTowardMetrics: false })],
    });
    const notice = screen.getByRole('status');
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent(/closed on tracker silence/i);
    expect(notice).toHaveTextContent('2026-08-20');
  });

  it('marks the timed-out legs so the map can draw them differently', () => {
    renderMap({
      allTripsTimedOut: true, timedOutTrips: 1,
      trips: [trip({ closeReason: 'timeout', countsTowardMetrics: false })],
    });
    const [props] = mapMocks.props.mock.calls[0] as [FleetMapProps];
    expect(props.dayRoute?.[0]?.closeReason).toBe('timeout');
    expect(props.dayRoute?.[0]?.endLabel).toMatch(/tracker went silent/i);
  });

  it('warns about a partly timed-out day too, without claiming the whole day is', () => {
    renderMap({ timedOutTrips: 1, trips: [trip(), trip({ id: 't2', closeReason: 'timeout' })] });
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 trips closed on tracker silence');
  });
});

describe('the empty day', () => {
  it('says nothing was recorded and does not claim the vehicle was parked', () => {
    renderMap({ trips: [] });
    expect(screen.getByText(/No trip was recorded for 2026-08-20/)).toBeVisible();
    expect(screen.getByText(/not the same as a day spent parked/i)).toBeVisible();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('endpoints versus recorded fixes', () => {
  it('says a line is endpoints-only until positions are loaded', () => {
    renderMap();
    expect(screen.getByText(/not the road driven/i)).toBeVisible();
    const [props] = mapMocks.props.mock.calls[0] as [FleetMapProps];
    expect(props.dayRoute?.[0]?.path).toEqual([[-26.2, 28.0], [-26.1, 28.1]]);
  });

  it('follows the recorded fixes inside the trip once they are loaded', () => {
    renderMap({
      positions: [
        position('2026-08-20T05:00:00.000Z', -25.0, 27.0), // before the trip: excluded
        position('2026-08-20T06:10:00.000Z', -26.18, 28.02),
        position('2026-08-20T06:40:00.000Z', -26.13, 28.07),
        position('2026-08-20T08:00:00.000Z', -27.0, 29.0), // after the trip: excluded
      ],
    });
    const [props] = mapMocks.props.mock.calls[0] as [FleetMapProps];
    expect(props.dayRoute?.[0]?.path).toEqual([[-26.18, 28.02], [-26.13, 28.07]]);
    expect(screen.getByText(/Drawn from 4 recorded fixes/)).toBeVisible();
  });
});

describe('a trip with no coordinates', () => {
  it('is counted out loud rather than silently missing from the map', () => {
    renderMap({
      trips: [trip(), trip({
        id: 't2', start: { lat: null, lon: null, place: null },
        end: { lat: null, lon: null, place: null },
      })],
    });
    expect(screen.getByText(/1 trip\(s\) carry no usable coordinates/)).toBeVisible();
    expect(screen.getByTestId('fleet-map')).toHaveTextContent('route legs: 1');
  });
});
