import { describe, expect, it } from 'vitest';
import { classifyPointAtSite, pointsWithinMismatchTolerance } from '../geometry';

describe('classifyPointAtSite', () => {
  const circle = { kind: 'circle' as const, center: { latitude: -26, longitude: 28 }, radiusM: 100, active: true };

  it('treats the circle boundary inclusively and measures distance to its edge', () => {
    const boundaryLongitude = 28 + (100 / (111_195 * Math.cos(-26 * Math.PI / 180)));
    expect(classifyPointAtSite({ latitude: -26, longitude: boundaryLongitude, recordedAt: '2026-08-13T08:00:00Z' }, circle)).toMatchObject({ valid: true, inside: true, distanceM: 0 });
    expect(classifyPointAtSite({ latitude: -26, longitude: 28, recordedAt: '2026-08-13T08:00:00Z' }, circle)).toMatchObject({ inside: true, distanceM: 0 });
    expect(classifyPointAtSite({ latitude: -26, longitude: 28.002, recordedAt: '2026-08-13T08:00:00Z' }, circle)).toMatchObject({ inside: false });
  });

  it('consumes normalized PostGIS polygon containment and boundary distance', () => {
    expect(classifyPointAtSite({ latitude: -26, longitude: 28, recordedAt: '2026-08-13T08:00:00Z' }, { kind: 'polygon', active: true, inside: true, distanceM: 0 })).toMatchObject({ valid: true, inside: true, distanceM: 0 });
    expect(classifyPointAtSite({ latitude: -26, longitude: 28, recordedAt: '2026-08-13T08:00:00Z' }, { kind: 'polygon', active: true, inside: false, distanceM: 37 })).toMatchObject({ valid: true, inside: false, distanceM: 37 });
  });

  it('rejects invalid points and retired geometry', () => {
    expect(classifyPointAtSite({ latitude: 91, longitude: 28, recordedAt: '2026-08-13T08:00:00Z' }, circle)).toMatchObject({ valid: false, reason: 'invalid_point' });
    expect(classifyPointAtSite({ latitude: -26, longitude: 28, recordedAt: '2026-08-13T08:00:00Z' }, { ...circle, active: false })).toMatchObject({ valid: false, reason: 'inactive_geometry' });
  });

  it('uses an inclusive 250m mismatch tolerance for two known sites', () => {
    expect(pointsWithinMismatchTolerance({ latitude: -26, longitude: 28 }, { latitude: -26, longitude: 28.0024 }, 250)).toBe(true);
    expect(pointsWithinMismatchTolerance({ latitude: -26, longitude: 28 }, { latitude: -26, longitude: 28.0026 }, 250)).toBe(false);
  });
});
