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

import { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveVehicle } from '@/pages/api/fleet/positions/live';
import { ageLabel, colourFor, partitionVehicles } from '../utils/liveMapHelpers';

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

export default function FleetMap({ vehicles }: { vehicles: LiveVehicle[] }) {
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
      {plotted.map((v) => (
        <CircleMarker
          key={v.vehicleId}
          center={[v.lat, v.lon]}
          radius={7}
          pathOptions={{ color: colourFor(v), fillColor: colourFor(v), fillOpacity: v.isStale ? 0.35 : 0.85 }}
        >
          <Popup>
            <strong>{v.registration}</strong>
            <br />
            {v.driverName ?? 'No driver assigned'}
            <br />
            {v.ignition ? 'Moving' : 'Stopped'}
            {v.speedKph !== null ? ` · ${Math.round(v.speedKph)} km/h` : ''}
            {v.isSpeeding ? ' · SPEEDING' : ''}
            <br />
            Last fix: {ageLabel(v.ageSeconds)}
            {v.isStale ? ' (stale)' : ''}
            <br />
            <small>via {v.provider ?? 'unknown'}</small>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
