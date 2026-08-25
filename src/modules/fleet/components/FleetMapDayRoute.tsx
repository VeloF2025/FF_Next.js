/**
 * One vehicle-day's route, drawn inside the existing `FleetMap`.
 *
 * A separate file rather than more of `FleetMap` because the two draw different things: FleetMap
 * plots LIVE vehicles, whose marker fill means movement state and whose white ring means GPS
 * freshness. A historical route has neither property, and reusing that grammar for it would say
 * something about freshness that is not true. Nothing here is a `LiveVehicle`.
 *
 * A trip closed by tracker silence (`close_reason = 'timeout'`) has a real start and an UNKNOWN
 * end, so its line is dashed and its end marker is hollow. Drawing it solid would present the
 * place the signal died as the place the vehicle stopped.
 */
'use client';

import { Fragment } from 'react';
import { CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';

export interface RouteLeg {
  id: string;
  /** Ordered `[lat, lon]` pairs. Two points for a trip with only endpoints; more with positions. */
  path: [number, number][];
  countsTowardMetrics: boolean;
  closeReason: string;
  label: string;
  endLabel: string;
}

const SOLID = { color: '#2563eb', weight: 4, opacity: 0.85 };
const DASHED = { color: '#d97706', weight: 4, opacity: 0.85, dashArray: '8 6' };

export interface FleetMapDayRouteProps {
  legs: RouteLeg[];
}

export default function FleetMapDayRoute({ legs }: FleetMapDayRouteProps) {
  return (
    <>
      {legs.map((leg) => {
        const timedOut = leg.closeReason === 'timeout';
        const start = leg.path[0];
        const end = leg.path[leg.path.length - 1];
        return (
          <Fragment key={leg.id}>
            {leg.path.length > 1 && (
              <Polyline
                positions={leg.path}
                pathOptions={timedOut ? DASHED : SOLID}
                data-testid={`route-line-${leg.id}`}
              />
            )}
            {start && (
              <CircleMarker
                center={start}
                radius={6}
                pathOptions={{ color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }}
              >
                <Tooltip>{leg.label}</Tooltip>
              </CircleMarker>
            )}
            {end && (
              <CircleMarker
                center={end}
                radius={6}
                pathOptions={{
                  color: timedOut ? '#d97706' : '#dc2626',
                  fillColor: timedOut ? 'transparent' : '#dc2626',
                  fillOpacity: timedOut ? 0 : 1,
                }}
              >
                <Popup>
                  <span>{leg.endLabel}</span>
                </Popup>
              </CircleMarker>
            )}
          </Fragment>
        );
      })}
    </>
  );
}
