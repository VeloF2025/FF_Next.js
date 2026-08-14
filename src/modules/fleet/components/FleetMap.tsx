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
import { STATUS_STYLE, ageLabel, partitionVehicles, statusFor } from '../utils/liveMapHelpers';

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
      {plotted.map((v) => {
        const style = STATUS_STYLE[statusFor(v)];
        return (
          <CircleMarker
            key={v.vehicleId}
            center={[v.lat, v.lon]}
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
            <Popup>
              <strong>{v.registration}</strong>
              <br />
              {v.driverName ?? 'No driver assigned'}
              <br />
              {style.label}
              {v.speedKph !== null ? ` · ${Math.round(v.speedKph)} km/h` : ''}
              {v.isSpeeding ? ' · SPEEDING' : ''}
              <br />
              {/*
                No "(stale)" suffix. `statusFor` already says it, and says it
                better: parkedSilent reads "Parked · no contact", lostContact
                reads "Lost contact", unknown reads "No recent fix". The suffix
                only ever repeated those — except on a PARKED vehicle, where it
                flatly contradicted them. statusFor's own reasoning is that an
                engine-off vehicle "is not moving, so its last position stays
                true for as long as it stays off"; appending "(stale)" to that
                told the reader not to trust a position we are most certain of.
                Observed live: a vehicle parked and switched off at 15:13
                (Cartrack's last event for it was literally "Ign OFF", confirmed
                against their API) rendered "Parked · no contact ... (stale)".
                Nothing was wrong — it was parked, exactly as stated.

                `isStale` itself stays load-bearing in liveMapHelpers, where it
                gates `speeding` on a fresh fix and turns ignition-on silence
                into `lostContact`. Only this redundant echo of it is gone.
              */}
              Last fix: {ageLabel(v.ageSeconds)}
              <br />
              <small>via {v.provider ?? 'unknown'}</small>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
