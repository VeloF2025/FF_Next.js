import React from 'react';

import { captureGPSWithFallback, queryGeolocationPermission } from '@/modules/fleet/offline/gpsCapture';
import { getReverseGeocode } from '../api';
import type { GeocodeResult } from '../api';
import type { GpsSnapshot } from '../clockSteps';
import { classifyDenialFollowup } from '../gpsPlatform';

export function useClockEvidence() {
  const [selfieFile, setSelfieFile] = React.useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = React.useState<string | null>(null);
  const [gps, setGps] = React.useState<GpsSnapshot | null>(null);
  const [gpsAddress, setGpsAddress] = React.useState<string | null>(null);
  const [gpsDenied, setGpsDenied] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cameraRef = React.useRef<HTMLInputElement>(null);
  const gpsInFlight = React.useRef(false);

  React.useEffect(() => () => {
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
  }, [selfiePreview]);

  React.useEffect(() => {
    let cancelled = false;
    queryGeolocationPermission().then((state) => {
      if (!cancelled && state === 'denied') setGpsDenied(true);
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!gps) { setGpsAddress(null); return; }
    let cancelled = false;
    getReverseGeocode(gps.lat, gps.lon).then((result: GeocodeResult | null) => {
      if (!cancelled && result) setGpsAddress(formatGeocode(result));
    });
    return () => { cancelled = true; };
  }, [gps]);

  const captureGpsOnce = React.useCallback(async () => {
    if (gpsInFlight.current) return;
    gpsInFlight.current = true;
    setCapturing(true);
    setError(null);
    try {
      const result = await captureGPSWithFallback(10_000, 15_000);
      if (result.success && result.coordinates) {
        setGpsDenied(false);
        setGps(toSnapshot(result.coordinates));
      } else if (result.errorKind === 'denied') {
        const followup = classifyDenialFollowup(await queryGeolocationPermission());
        if (followup === 'show-help') {
          setGpsDenied(true);
        } else if (followup === 'retry') {
          const retry = await captureGPSWithFallback(10_000, 15_000);
          if (retry.success && retry.coordinates) {
            setGpsDenied(false);
            setGps(toSnapshot(retry.coordinates));
          } else {
            setError(retry.error ?? 'Could not capture location. Tap "Get location" to try again.');
          }
        } else {
          setError('Location permission was dismissed. Tap "Get location" to try again.');
        }
      } else {
        setError(result.error ?? 'Could not capture location. Check GPS permission.');
      }
    } finally {
      setCapturing(false);
      gpsInFlight.current = false;
    }
  }, []);

  const handleSelfieChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    if (!file) return;
    if (selfiePreview) URL.revokeObjectURL(selfiePreview);
    setSelfieFile(file);
    setSelfiePreview(URL.createObjectURL(file));
    void captureGpsOnce();
  };

  return {
    selfieFile, selfiePreview, gps, gpsAddress, gpsDenied, capturing, error,
    cameraRef, captureGpsOnce, handleSelfieChange,
    retryDenied: () => { setGpsDenied(false); void captureGpsOnce(); },
  };
}

function toSnapshot(coordinates: {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}): GpsSnapshot {
  return {
    lat: coordinates.latitude,
    lon: coordinates.longitude,
    accuracyM: coordinates.accuracy,
    capturedAt: new Date(coordinates.timestamp).toISOString(),
  };
}

function formatGeocode(result: GeocodeResult): string {
  const city = result.city?.trim() && result.city !== 'Unknown City' ? result.city.trim() : '';
  const province = result.province?.trim() ?? '';
  return city && province ? `${city}, ${province}` : city || province;
}
