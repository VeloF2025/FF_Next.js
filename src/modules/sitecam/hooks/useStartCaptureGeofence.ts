// src/modules/sitecam/hooks/useStartCaptureGeofence.ts

import { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import {
  buildReading,
  encodeGeofenceParam,
  readDeviceLocation,
  type GeofenceReading,
} from '../lib/geofence';

const GPS_TIMEOUT_MS = 10_000;

interface SiteGeoTarget {
  siteId: string;
  plannedLat: number | null;
  plannedLon: number | null;
}

/** Statuses that require a technician-facing warning before navigation. */
function needsWarning(r: GeofenceReading): boolean {
  return r.status === 'out_of_range' || r.status === 'device_gps_off';
}

export function useStartCaptureGeofence(site: SiteGeoTarget) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<GeofenceReading | null>(null);

  const navigate = useCallback(
    (reading: GeofenceReading) => {
      void router.push({
        pathname: '/my/sitecam/[siteId]',
        query: { siteId: site.siteId, gf: encodeGeofenceParam(reading) },
      });
    },
    [router, site.siteId],
  );

  const beginCapture = useCallback(async () => {
    setChecking(true);
    setPendingWarning(null);
    try {
      const pos = await readDeviceLocation(GPS_TIMEOUT_MS);
      const reading = buildReading({
        plannedLat: site.plannedLat,
        plannedLon: site.plannedLon,
        deviceLat: pos?.lat ?? null,
        deviceLon: pos?.lon ?? null,
        accuracyM: pos?.accuracy ?? null,
      });
      if (needsWarning(reading)) {
        setPendingWarning(reading);
      } else {
        navigate(reading);
      }
    } finally {
      setChecking(false);
    }
  }, [site.plannedLat, site.plannedLon, navigate]);

  const confirmContinue = useCallback(() => {
    if (pendingWarning) navigate(pendingWarning);
  }, [pendingWarning, navigate]);

  const dismiss = useCallback(() => setPendingWarning(null), []);

  return { checking, pendingWarning, beginCapture, confirmContinue, dismiss };
}
