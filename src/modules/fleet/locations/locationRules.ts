import type { LocationType } from '../types';

export const LOCATION_TYPES = [
  { value: 'work_site', label: 'Work site' },
  { value: 'office', label: 'Office' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'client', label: 'Client' },
  { value: 'depot', label: 'Depot' },
  { value: 'other', label: 'Other' },
] as const satisfies ReadonlyArray<{ value: LocationType; label: string }>;

const VALUES = new Set<string>(LOCATION_TYPES.map((item) => item.value));

export interface LocationInput {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  locationType: LocationType;
  isGlobal: boolean;
  vehicleId: string | null;
}

export type LocationValidationErrors = Partial<Record<keyof LocationInput, string>>;

export function isLocationType(value: unknown): value is LocationType {
  return typeof value === 'string' && VALUES.has(value);
}

export function validateLocationInput(input: LocationInput): LocationValidationErrors {
  const errors: LocationValidationErrors = {};
  if (!input.name.trim()) errors.name = 'Name is required';
  else if (input.name.trim().length > 100) errors.name = 'Name must be 100 characters or less';
  if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) errors.lat = 'Latitude must be between -90 and 90';
  if (!Number.isFinite(input.lon) || input.lon < -180 || input.lon > 180) errors.lon = 'Longitude must be between -180 and 180';
  if (!Number.isFinite(input.radiusKm) || input.radiusKm <= 0 || input.radiusKm > 100) errors.radiusKm = 'Radius must be between 0 and 100 km';
  if (!isLocationType(input.locationType)) errors.locationType = 'Select a valid location type';
  if (!input.isGlobal && !input.vehicleId) errors.vehicleId = 'Vehicle is required for a vehicle-specific location';
  return errors;
}
