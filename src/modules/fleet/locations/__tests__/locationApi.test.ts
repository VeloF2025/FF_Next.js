import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLocation,
  deactivateLocation,
  listLocations,
  reactivateLocation,
  updateLocation,
} from '../locationApi';
import type { AuthorizedLocation } from '../../types';
import type { LocationInput } from '../locationRules';

const location: AuthorizedLocation = {
  id: 'location-1',
  name: 'Riverside depot',
  lat: -26.2041,
  lon: 28.0473,
  radiusKm: 1.5,
  locationType: 'depot',
  isGlobal: true,
  vehicleId: null,
  isActive: true,
};

const input: LocationInput = {
  name: 'Riverside depot',
  lat: -26.2041,
  lon: 28.0473,
  radiusKm: 1.5,
  locationType: 'depot',
  isGlobal: true,
  vehicleId: null,
};

function apiResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue({ success: true, data }),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('locationApi', () => {
  it('lists active locations from the authorized locations endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse([location]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listLocations(false)).resolves.toEqual([location]);
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations', { method: 'GET' });
  });

  it('lists inactive locations by including the active false query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse([location]));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listLocations(true)).resolves.toEqual([location]);
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations?active=false', { method: 'GET' });
  });

  it('creates a location with the submitted input', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(location, 201));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createLocation(input)).resolves.toEqual(location);
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('updates a location at its existing endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(location));
    vi.stubGlobal('fetch', fetchMock);

    await expect(updateLocation('location-1', input)).resolves.toEqual(location);
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations?id=location-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });

  it('deactivates a location through its existing delete endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse({ id: 'location-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deactivateLocation('location-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations?id=location-1', { method: 'DELETE' });
  });

  it('reactivates a location with an active update request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(apiResponse(location));
    vi.stubGlobal('fetch', fetchMock);

    await expect(reactivateLocation('location-1')).resolves.toEqual(location);
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet/locations?id=location-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
  });

  it('surfaces a forbidden response message to the caller', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ success: false, error: { message: 'You cannot manage locations' } }),
    } as unknown as Response));

    await expect(listLocations(false)).rejects.toThrow('You cannot manage locations');
  });

  it('does not return fake success for a server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ success: true, data: location }),
    } as unknown as Response));

    await expect(createLocation(input)).rejects.toThrow('Location request failed');
  });
});
