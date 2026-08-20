import { describe, it, expect } from 'vitest';
import { geofenceColumns } from '@/pages/api/sitecam/upload';

describe('geofenceColumns', () => {
  it('returns nine ordered values from a payload', () => {
    expect(geofenceColumns({
      status: 'out_of_range', distanceM: 140.4,
      plannedLat: -26.1, plannedLon: 27.5,
      deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5,
      submitLat: -26.2, submitLon: 27.6,
    })).toEqual(['out_of_range', 140.4, -26.101, 27.5, -26.1, 27.5, 5, -26.2, 27.6]);
  });

  it('returns nine nulls when payload is null/undefined', () => {
    expect(geofenceColumns(null)).toEqual([null, null, null, null, null, null, null, null, null]);
    expect(geofenceColumns(undefined)).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
