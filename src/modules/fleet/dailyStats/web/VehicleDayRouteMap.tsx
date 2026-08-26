/**
 * One SAST day's route for one vehicle, drawn on the existing `FleetMap`.
 *
 * Two honesty rules the map has to carry, because a route is the most believable thing on this
 * page and both failure modes look like a normal journey:
 *
 *   A trip closed by tracker SILENCE (`close_reason = 'timeout'`) ends where the signal died, not
 *   where the vehicle stopped. Those legs are dashed with a hollow end marker, and a day made
 *   entirely of them says so in a banner above the map.
 *
 *   Without positions the line between a trip's two endpoints is a straight line, which is not the
 *   road that was driven. It is labelled as endpoints-only until the caller asks for the fixes.
 */
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import type { RouteLeg } from '../../components/FleetMapDayRoute';
import type { DayRoutePosition, DayRouteTrip } from './vehicleStatsApi';
import { formatDuration } from './statsDisplay';

const FleetMap = dynamic(() => import('../../components/FleetMap'), { ssr: false });

function timeLabel(at: string | null): string {
  if (at === null) return 'unknown time';
  return new Date(at).toLocaleTimeString('en-ZA', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg',
  });
}

/** The fixes that fall inside a trip, so a leg follows the road rather than cutting across it. */
function pathFor(trip: DayRouteTrip, positions: DayRoutePosition[] | null): [number, number][] {
  if (positions !== null && trip.ignitionOnAt !== null) {
    const from = Date.parse(trip.ignitionOnAt);
    const to = trip.ignitionOffAt === null ? Number.POSITIVE_INFINITY : Date.parse(trip.ignitionOffAt);
    const inside = positions
      .filter((p) => {
        if (p.lat === null || p.lon === null || p.recordedAt === null) return false;
        const at = Date.parse(p.recordedAt);
        return at >= from && at <= to;
      })
      .map((p) => [p.lat as number, p.lon as number] as [number, number]);
    if (inside.length > 1) return inside;
  }
  const path: [number, number][] = [];
  if (trip.start.lat !== null && trip.start.lon !== null) path.push([trip.start.lat, trip.start.lon]);
  if (trip.end.lat !== null && trip.end.lon !== null) path.push([trip.end.lat, trip.end.lon]);
  return path;
}

export interface VehicleDayRouteMapProps {
  workDate: string;
  trips: DayRouteTrip[];
  positions: DayRoutePosition[] | null;
  allTripsTimedOut: boolean;
  timedOutTrips: number;
  onRequestPositions?: () => void;
}

export default function VehicleDayRouteMap({
  workDate, trips, positions, allTripsTimedOut, timedOutTrips, onRequestPositions,
}: VehicleDayRouteMapProps) {
  const legs = useMemo<RouteLeg[]>(
    () => trips.flatMap((trip) => {
      const path = pathFor(trip, positions);
      if (path.length === 0) return [];
      const duration = trip.durationSeconds === null ? 'unknown duration' : formatDuration(trip.durationSeconds);
      return [{
        id: trip.id,
        path,
        countsTowardMetrics: trip.countsTowardMetrics,
        closeReason: trip.closeReason,
        label: `Start ${timeLabel(trip.ignitionOnAt)}${trip.start.place ? ` — ${trip.start.place}` : ''}`,
        endLabel: trip.closeReason === 'timeout'
          ? `Last fix ${timeLabel(trip.ignitionOffAt)} — the tracker went silent here; the vehicle may have carried on`
          : `End ${timeLabel(trip.ignitionOffAt)} (${duration})${trip.end.place ? ` — ${trip.end.place}` : ''}`,
      }];
    }),
    [trips, positions],
  );

  const plottable = legs.length;

  return (
    <div className="space-y-3" data-testid="vehicle-day-route">
      {allTripsTimedOut && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300"
        >
          Every trip on {workDate} closed on tracker silence, not on ignition off. Each route ends
          where the last fix arrived — not necessarily where the vehicle stopped.
        </p>
      )}
      {!allTripsTimedOut && timedOutTrips > 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-300"
        >
          {timedOutTrips} of {trips.length} trips closed on tracker silence and are drawn dashed;
          their end points are the last fix, not a confirmed stop.
        </p>
      )}
      {trips.length === 0 && (
        <p className="rounded-lg border border-[var(--ff-border-light)] px-3 py-2 text-sm text-[var(--ff-text-secondary)]">
          No trip was recorded for {workDate}. That is not the same as a day spent parked — no row
          means nothing was observed.
        </p>
      )}
      {trips.length > plottable && (
        <p className="text-xs text-[var(--ff-text-secondary)]">
          {trips.length - plottable} trip(s) carry no usable coordinates and are not drawn.
        </p>
      )}
      <div className="h-[420px] overflow-hidden rounded-xl border border-[var(--ff-border-light)]">
        <FleetMap vehicles={[]} showVehicleMarkers={false} dayRoute={legs} />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--ff-text-secondary)]">
        <span>
          {positions === null
            ? 'Lines join each trip’s start and end only — not the road driven.'
            : `Drawn from ${positions.length} recorded fixes.`}
        </span>
        {positions === null && onRequestPositions && (
          <button
            type="button"
            onClick={onRequestPositions}
            className="rounded-lg border border-[var(--ff-border-light)] px-3 py-1 hover:bg-[var(--ff-bg-tertiary)]"
          >
            Load recorded fixes
          </button>
        )}
      </div>
    </div>
  );
}
