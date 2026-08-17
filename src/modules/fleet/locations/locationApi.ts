import type { AuthorizedLocation } from '../types';
import type { LocationInput } from './locationRules';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Location request failed');
  }
  return payload.data;
}

function locationUrl(id?: string): string {
  return id ? `/api/fleet/locations?id=${encodeURIComponent(id)}` : '/api/fleet/locations';
}

function requestLocation<T>(url: string, init: RequestInit): Promise<T> {
  return fetch(url, init).then(readResponse<T>);
}

export function listLocations(includeInactive: boolean): Promise<AuthorizedLocation[]> {
  const url = includeInactive ? '/api/fleet/locations?active=false' : locationUrl();
  return requestLocation<AuthorizedLocation[]>(url, { method: 'GET' });
}

export function createLocation(input: LocationInput): Promise<AuthorizedLocation> {
  return requestLocation<AuthorizedLocation>(locationUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateLocation(id: string, input: LocationInput): Promise<AuthorizedLocation> {
  return requestLocation<AuthorizedLocation>(locationUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function deactivateLocation(id: string): Promise<void> {
  await requestLocation<{ id: string }>(locationUrl(id), { method: 'DELETE' });
}

export function reactivateLocation(id: string): Promise<AuthorizedLocation> {
  return requestLocation<AuthorizedLocation>(locationUrl(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: true }),
  });
}
