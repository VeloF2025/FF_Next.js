/**
 * GPS Capture Utility
 * Captures device location for offline submissions
 */

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

/**
 * Discriminated failure kind so callers can render specific UI without
 * string-matching the message.
 *
 *   - 'denied'      — PERMISSION_DENIED. The user (or browser policy) said
 *                     no. The platform will not re-prompt until the user
 *                     clears the deny in OS/browser settings.
 *   - 'unavailable' — POSITION_UNAVAILABLE. Sensors failed; e.g. no GPS
 *                     lock indoors.
 *   - 'timeout'     — TIMEOUT. The sensor is trying but hasn't produced a
 *                     fix in time. Retry usually helps.
 *   - 'unsupported' — navigator.geolocation not present (rare).
 *   - 'unknown'     — anything else.
 */
export type GPSErrorKind =
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'unsupported'
  | 'unknown';

export interface GPSCaptureResult {
  success: boolean;
  coordinates?: GPSCoordinates;
  /** Human-readable message (safe to show in a generic error banner). */
  error?: string;
  /** Machine-readable kind for branching UI. Only set when success=false. */
  errorKind?: GPSErrorKind;
}

/**
 * Check if geolocation is available
 */
export function isGeolocationAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Capture current GPS coordinates
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @param highAccuracy - Use high accuracy mode (default: true)
 */
export async function captureGPS(
  timeout = 10000,
  highAccuracy = true
): Promise<GPSCaptureResult> {
  if (!isGeolocationAvailable()) {
    return {
      success: false,
      error: 'Geolocation not available',
      errorKind: 'unsupported',
    };
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          success: true,
          coordinates: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          },
        });
      },
      (error) => {
        let errorMessage = 'Unknown error';
        let errorKind: GPSErrorKind = 'unknown';
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location permission denied';
            errorKind = 'denied';
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location unavailable';
            errorKind = 'unavailable';
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out';
            errorKind = 'timeout';
            break;
        }
        resolve({
          success: false,
          error: errorMessage,
          errorKind,
        });
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout,
        maximumAge: 30000, // Accept cached position up to 30 seconds old
      }
    );
  });
}

/**
 * Query the Permissions API to learn the current geolocation permission
 * state WITHOUT triggering a prompt. Returns `'unsupported'` when the
 * Permissions API isn't available (some older browsers).
 *
 * Use this on mount to detect a pre-existing deny — calling
 * `getCurrentPosition` in that state will silently hang on iOS Safari
 * instead of firing the error callback, so pre-checking prevents a
 * locked UI.
 */
export async function queryGeolocationPermission(): Promise<
  'granted' | 'denied' | 'prompt' | 'unsupported'
> {
  if (typeof navigator === 'undefined') return 'unsupported';
  // Permissions API availability varies: Safari added it late (iOS 16+),
  // and some wrappers don't support the 'geolocation' descriptor. Wrap
  // both the presence check and the call itself.
  const perms = (navigator as Navigator & { permissions?: Permissions })
    .permissions;
  if (!perms || typeof perms.query !== 'function') return 'unsupported';
  try {
    const status = await perms.query({ name: 'geolocation' as PermissionName });
    return status.state as 'granted' | 'denied' | 'prompt';
  } catch {
    return 'unsupported';
  }
}

/**
 * Watch position changes (for real-time tracking)
 */
export function watchGPS(
  onUpdate: (result: GPSCaptureResult) => void,
  highAccuracy = true
): number | null {
  if (!isGeolocationAvailable()) {
    onUpdate({ success: false, error: 'Geolocation not available' });
    return null;
  }

  return navigator.geolocation.watchPosition(
    (position) => {
      onUpdate({
        success: true,
        coordinates: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        },
      });
    },
    (error) => {
      onUpdate({
        success: false,
        error: error.message,
      });
    },
    {
      enableHighAccuracy: highAccuracy,
      timeout: 15000,
      maximumAge: 10000,
    }
  );
}

/**
 * Stop watching GPS
 */
export function stopWatchingGPS(watchId: number): void {
  if (isGeolocationAvailable() && watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }
}

/**
 * Format coordinates for display
 */
export function formatCoordinates(coords: GPSCoordinates): string {
  return `${coords.latitude.toFixed(6)}, ${coords.longitude.toFixed(6)}`;
}

/**
 * Calculate distance between two coordinates in kilometers
 */
export function calculateDistance(
  coord1: { latitude: number; longitude: number },
  coord2: { latitude: number; longitude: number }
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(coord2.latitude - coord1.latitude);
  const dLon = toRadians(coord2.longitude - coord1.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(coord1.latitude)) *
      Math.cos(toRadians(coord2.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}
