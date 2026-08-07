/**
 * Typed client wrapper over /api/my/vehicle/parking.
 *
 * Kept out of the page so the page stays a view. Every function throws
 * ParkingApiError with the HTTP status attached — the page distinguishes a 404
 * (no vehicle assigned) from a genuine failure.
 */
import type { DriverParkingState, ParkingDeclaration } from '../types';

export class ParkingApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ParkingApiError';
    this.status = status;
  }
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: { message?: string };
}

async function request<T>(init: RequestInit & { url: string }): Promise<T> {
  const { url, ...rest } = init;
  const res = await fetch(url, { credentials: 'same-origin', ...rest });

  let payload: Envelope<T> | null = null;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    // A non-JSON body (a proxy error page, say) is a failure with no message.
    payload = null;
  }

  if (!res.ok || payload?.success !== true || payload.data === undefined) {
    throw new ParkingApiError(
      payload?.error?.message ?? 'Something went wrong. Please try again.',
      res.status
    );
  }
  return payload.data;
}

export function fetchParkingState(): Promise<DriverParkingState> {
  return request<DriverParkingState>({ url: '/api/my/vehicle/parking', method: 'GET' });
}

export interface DeclarationBody {
  lat: number;
  lon: number;
  accuracyM: number;
  label?: string;
  requestNote?: string;
}

export function submitDeclaration(
  body: DeclarationBody
): Promise<{ declaration: ParkingDeclaration }> {
  return request<{ declaration: ParkingDeclaration }>({
    url: '/api/my/vehicle/parking',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function withdrawDeclaration(): Promise<{ withdrawn: boolean }> {
  return request<{ withdrawn: boolean }>({ url: '/api/my/vehicle/parking', method: 'DELETE' });
}

/**
 * Display-only label for a freshly captured point. The route never throws and
 * always answers `{ geocode: … | null }`, so a failure here is silent and the
 * UI falls back to "Unnamed location" (spec §11).
 */
export async function fetchGeocodeLabel(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/my/geocode?lat=${lat}&lon=${lon}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      data?: {
        geocode?: { city?: string; municipalDistrict?: string; province?: string } | null;
      };
    };
    const geo = payload.data?.geocode;
    if (!geo) return null;
    const parts = [geo.city, geo.municipalDistrict, geo.province].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
