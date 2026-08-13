import { haversineDistanceM, isValidLatLon } from '@/lib/geo';
import type { OperationalPoint } from './types';

export interface CircleSiteGeometry {
  kind: 'circle'; active: boolean; center: Pick<OperationalPoint, 'latitude' | 'longitude'>; radiusM: number;
}

export interface PolygonSiteGeometry {
  kind: 'polygon'; active: boolean; inside: boolean; distanceM: number;
}

export type SiteGeometry = CircleSiteGeometry | PolygonSiteGeometry;
export interface SitePointResult {
  valid: boolean; inside: boolean; distanceM: number | null;
  reason: 'invalid_point' | 'inactive_geometry' | 'invalid_geometry' | null;
}

const DISTANCE_EPSILON_M = 0.01;

export function classifyPointAtSite(point: OperationalPoint, geometry: SiteGeometry): SitePointResult {
  if (!isValidLatLon({ lat: point.latitude, lon: point.longitude })) {
    return { valid: false, inside: false, distanceM: null, reason: 'invalid_point' };
  }
  if (!geometry.active) return { valid: false, inside: false, distanceM: null, reason: 'inactive_geometry' };
  if (geometry.kind === 'polygon') {
    if (!Number.isFinite(geometry.distanceM) || geometry.distanceM < 0) {
      return { valid: false, inside: false, distanceM: null, reason: 'invalid_geometry' };
    }
    return { valid: true, inside: geometry.inside, distanceM: geometry.inside ? 0 : geometry.distanceM, reason: null };
  }
  if (!isValidLatLon({ lat: geometry.center.latitude, lon: geometry.center.longitude })
    || !Number.isFinite(geometry.radiusM) || geometry.radiusM <= 0) {
    return { valid: false, inside: false, distanceM: null, reason: 'invalid_geometry' };
  }
  const centerDistance = haversineDistanceM(
    { lat: point.latitude, lon: point.longitude },
    { lat: geometry.center.latitude, lon: geometry.center.longitude },
  );
  const inside = centerDistance <= geometry.radiusM + DISTANCE_EPSILON_M;
  return { valid: true, inside, distanceM: inside ? 0 : centerDistance - geometry.radiusM, reason: null };
}

export function pointsWithinMismatchTolerance(
  first: Pick<OperationalPoint, 'latitude' | 'longitude'>,
  second: Pick<OperationalPoint, 'latitude' | 'longitude'>,
  toleranceM: number,
): boolean {
  if (!isValidLatLon({ lat: first.latitude, lon: first.longitude })
    || !isValidLatLon({ lat: second.latitude, lon: second.longitude })
    || !Number.isFinite(toleranceM) || toleranceM < 0) return false;
  return haversineDistanceM(
    { lat: first.latitude, lon: first.longitude },
    { lat: second.latitude, lon: second.longitude },
  ) <= toleranceM;
}
