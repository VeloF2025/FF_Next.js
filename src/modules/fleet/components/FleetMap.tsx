/**
 * Leaflet map of last-known vehicle positions.
 * Client-only: must be imported via next/dynamic with ssr:false (Leaflet
 * touches `window` at import time and breaks SSR).
 *
 * Marker colour, age labelling, and the plotted/not-plotted split are pure
 * functions in `../utils/liveMapHelpers` — unit-tested there. This
 * component just wires them into react-leaflet.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import type { OperationalMapOverlay } from '../operations/mapOverlayService';
import {
  STATUS_STYLE,
  ageLabel,
  distanceLabel,
  groupCentrePx,
  groupOverlapping,
  nearestNeighbourMeters,
  partitionVehicles,
  ringOffsetPx,
  statusFor,
} from '../utils/liveMapHelpers';
import type { PlottedVehicle } from '../utils/liveMapHelpers';
import { OperationalMapLayers } from './OperationalMapLayers';

export type { LiveVehicle };

/** Gauteng — where every observed position has been. */
const DEFAULT_CENTER: [number, number] = [-26.05, 28.1];

/**
 * Leaflet only re-measures its container on the window `resize` event. Inside
 * AppLayout the container also changes width with no window resize at all:
 * the sidebar toggles `lg:ml-16`/`lg:ml-64`, and on every load AppLayout
 * restores the persisted collapse state after hydration. Without this the
 * tiles stay laid out for the old width — grey gaps, wrong pan bounds — until
 * the user resizes the browser.
 */
function InvalidateSizeOnContainerResize() {
  const map = useMap();

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    // Coalesce the burst of callbacks fired during the 300ms sidebar
    // transition into one invalidateSize per frame.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.invalidateSize());
    });
    observer.observe(map.getContainer());

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

/**
 * The vehicle markers, fanned out where several vehicles share a spot.
 *
 * Lives inside MapContainer rather than beside it because the fan-out is done
 * in screen space: converting a pixel offset to a position needs the live map
 * instance, which only children of MapContainer can reach.
 */
function VehicleMarkers({ plotted }: { plotted: PlottedVehicle[] }) {
  const map = useMap();
  // A pixel covers a different amount of ground at every zoom level, so the
  // offset positions have to be recomputed whenever the zoom changes. `zoom`
  // fires throughout a pinch or scroll animation and `zoomend` only at the
  // end: without the former the fan-out is drawn at the pre-zoom scale for the
  // whole animation and visibly snaps when it lands.
  const [zoom, setZoom] = useState(() => map.getZoom());
  useMapEvents({
    zoom: () => setZoom(map.getZoom()),
    zoomend: () => setZoom(map.getZoom()),
  });

  // Project once per zoom: grouping and the fan-out are both screen-space, and
  // `project` is pure maths on the zoom level, independent of pan or container
  // size.
  const positioned = useMemo(
    () => plotted.map((v) => ({ vehicle: v, ...map.project([v.lat, v.lon], zoom) })),
    [plotted, map, zoom],
  );

  const groups = useMemo(() => groupOverlapping(positioned), [positioned]);

  const markers = useMemo(
    () =>
      groups.flatMap((group) => {
        const centre = groupCentrePx(group);
        return group.map(({ vehicle: v }, index) => {
          const style = STATUS_STYLE[statusFor(v)];
          const { dx, dy } = ringOffsetPx(index, group.length);
          const center =
            group.length === 1
              ? ([v.lat, v.lon] as [number, number])
              : map.unproject([centre.x + dx, centre.y + dy], zoom);
          const driver = v.driverName ?? 'No driver assigned';
          const nearestMeters = nearestNeighbourMeters(v, group);
          return (
            <CircleMarker
              key={v.vehicleId}
              center={center}
              radius={8}
              // White stroke, not a tinted one: on the pale OSM basemap the halo is
              // what makes a marker findable at a glance, the fill only says which
              // kind it is.
              pathOptions={{
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                dashArray: style.dash,
                fillColor: style.fill,
                fillOpacity: style.fillOpacity,
              }}
            >
              {/* Registration and driver on hover: without it the map answers
                  "where are my vehicles" but not "whose is that one" without a
                  click per marker. */}
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <strong>{v.registration}</strong> · {driver}
              </Tooltip>
              <Popup>
                <strong>{v.registration}</strong>
                <br />
                {driver}
                <br />
                {style.label}
                {v.speedKph !== null ? ` · ${Math.round(v.speedKph)} km/h` : ''}
                {v.isSpeeding ? ' · SPEEDING' : ''}
                <br />
                Last fix: {ageLabel(v.ageSeconds)}
                {v.isStale ? ' (stale)' : ''}
                <br />
                <small>via {v.provider ?? 'unknown'}</small>
                {nearestMeters !== null ? (
                  <>
                    <br />
                    {/* Say it, rather than let a nudged marker pass as a fix.
                        The distance is between the VEHICLES, never between the
                        markers — the gap you see is a drawing decision. */}
                    <small>
                      Marker nudged apart · {group.length} markers overlap here, nearest
                      vehicle {distanceLabel(nearestMeters)} away
                    </small>
                  </>
                ) : null}
              </Popup>
            </CircleMarker>
          );
        });
      }),
    [groups, map, zoom],
  );

  return <>{markers}</>;
}


export interface FleetMapProps {
  vehicles: LiveVehicle[];
  operationalOverlay?: OperationalMapOverlay;
  selectedStaffId?: string | null;
  onStaffSelect?: (staffId: string) => void;
}

export default function FleetMap({
  vehicles,
  operationalOverlay,
  selectedStaffId,
  onStaffSelect,
}: FleetMapProps) {
  const { plotted } = partitionVehicles(vehicles);
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={10} style={{ height: '100%', width: '100%' }}>
      <InvalidateSizeOnContainerResize />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={18}
        detectRetina
      />
      <VehicleMarkers plotted={plotted} />
      {operationalOverlay && (
        <OperationalMapLayers
          onStaffSelect={onStaffSelect}
          operationalOverlay={operationalOverlay}
          selectedStaffId={selectedStaffId}
          vehicles={vehicles}
        />
      )}
    </MapContainer>
  );
}
