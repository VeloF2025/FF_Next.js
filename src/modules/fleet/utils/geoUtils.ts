/**
 * Geo Utilities
 * Haversine distance calculation and geofencing utilities
 */

/**
 * Coordinate type for lat/lon points
 */
export interface Coordinate {
  lat: number;
  lon: number;
}

/**
 * Location with radius for geofencing
 */
export interface LocationWithRadius extends Coordinate {
  id: string;
  name: string;
  radiusKm: number;
}

/**
 * Result of finding nearest location
 */
export interface NearestLocationResult {
  location: LocationWithRadius;
  distanceKm: number;
}

/**
 * Earth's radius in kilometers
 */
const EARTH_RADIUS_KM = 6371;

/**
 * Convert degrees to radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the Haversine distance between two coordinates
 *
 * The Haversine formula determines the great-circle distance between
 * two points on a sphere given their longitudes and latitudes.
 *
 * @param point1 - First coordinate (lat, lon)
 * @param point2 - Second coordinate (lat, lon)
 * @returns Distance in kilometers
 */
export function haversineDistance(point1: Coordinate, point2: Coordinate): number {
  // Same point = 0 distance
  if (point1.lat === point2.lat && point1.lon === point2.lon) {
    return 0;
  }

  const lat1 = toRadians(point1.lat);
  const lat2 = toRadians(point2.lat);
  const deltaLat = toRadians(point2.lat - point1.lat);
  const deltaLon = toRadians(point2.lon - point1.lon);

  // Haversine formula
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_KM * c;
}

/**
 * Check if a point is within a radius of a center point
 *
 * @param point - The point to check
 * @param center - The center of the radius
 * @param radiusKm - The radius in kilometers
 * @returns true if point is within or on the radius boundary
 */
export function isWithinRadius(
  point: Coordinate,
  center: Coordinate,
  radiusKm: number
): boolean {
  const distance = haversineDistance(point, center);
  return distance <= radiusKm;
}

/**
 * Find the nearest location from a list of locations
 *
 * @param point - The point to find nearest location for
 * @param locations - Array of locations to search
 * @returns The nearest location with distance, or null if no locations
 */
export function findNearestLocation(
  point: Coordinate,
  locations: LocationWithRadius[]
): NearestLocationResult | null {
  if (locations.length === 0) {
    return null;
  }

  let nearestLocation: LocationWithRadius | null = null;
  let nearestDistance = Infinity;

  for (const location of locations) {
    const distance = haversineDistance(point, {
      lat: location.lat,
      lon: location.lon,
    });

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestLocation = location;
    }
  }

  if (!nearestLocation) {
    return null;
  }

  return {
    location: nearestLocation,
    distanceKm: nearestDistance,
  };
}

/**
 * Check if a point is within any of the provided authorized locations
 *
 * @param point - The point to check
 * @param locations - Array of authorized locations with radii
 * @returns The matching location if within radius, or null
 */
export function findMatchingLocation(
  point: Coordinate,
  locations: LocationWithRadius[]
): LocationWithRadius | null {
  for (const location of locations) {
    if (
      isWithinRadius(
        point,
        { lat: location.lat, lon: location.lon },
        location.radiusKm
      )
    ) {
      return location;
    }
  }
  return null;
}

/**
 * Calculate total distance of a route (array of points)
 *
 * @param points - Array of coordinates representing the route
 * @returns Total distance in kilometers
 */
export function calculateRouteDistance(points: Coordinate[]): number {
  if (points.length < 2) {
    return 0;
  }

  let totalDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (from && to) {
      totalDistance += haversineDistance(from, to);
    }
  }

  return totalDistance;
}

/**
 * Get bearing from one point to another
 *
 * @param from - Starting coordinate
 * @param to - Ending coordinate
 * @returns Bearing in degrees (0-360)
 */
export function getBearing(from: Coordinate, to: Coordinate): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLon = toRadians(to.lon - from.lon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  let bearing = Math.atan2(y, x) * (180 / Math.PI);

  // Normalize to 0-360
  bearing = (bearing + 360) % 360;

  return bearing;
}
