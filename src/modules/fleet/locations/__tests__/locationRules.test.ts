import { describe, expect, it } from 'vitest';
import { isLocationType, validateLocationInput } from '../locationRules';

describe('locationRules', () => {
  it('accepts office because Attendance already consumes office geofences', () => {
    expect(isLocationType('office')).toBe(true);
  });

  it('rejects non-finite coordinates and an excessive radius', () => {
    expect(validateLocationInput({
      name: 'Riverside', lat: Number.NaN, lon: 28.1, radiusKm: 101,
      locationType: 'work_site', isGlobal: true, vehicleId: null,
    })).toEqual({ lat: 'Latitude must be between -90 and 90', radiusKm: 'Radius must be between 0 and 100 km' });
  });

  it('requires a vehicle when the location is not global', () => {
    expect(validateLocationInput({
      name: 'Vehicle yard', lat: -26.1, lon: 28.1, radiusKm: 1,
      locationType: 'depot', isGlobal: false, vehicleId: null,
    }).vehicleId).toBe('Vehicle is required for a vehicle-specific location');
  });
});
