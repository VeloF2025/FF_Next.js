/**
 * Trip Classifier Service
 * Classifies GPS trips as authorized/unauthorized based on geofencing
 */

import type {
  TripClassification,
  TimeCategory,
  DayType,
  ClassifiedTrip,
  GPSTrip,
  AuthorizedLocation,
} from '../types';
import { findNearestLocation, findMatchingLocation, type LocationWithRadius } from '../utils/geoUtils';
import { getTimeCategory, getDayType, isWorkHours } from '../utils/dateUtils';

/**
 * Trip data needed for classification
 */
export interface TripForClassification {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  startTime: Date;
}

/**
 * Authorized location for classification (subset of full type)
 */
export interface AuthorizedLocationForClassification {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  isGlobal: boolean;
  vehicleId: string | null;
}

/**
 * Classification result
 */
export interface ClassificationResult {
  classification: TripClassification;
  timeCategory: TimeCategory;
  dayType: DayType;
  isWorkHoursViolation: boolean;
  nearestAuthLocation: string | null;
  distanceFromAuthKm: number | null;
}

/**
 * Filter authorized locations for a specific vehicle
 * Returns global locations + vehicle-specific locations
 */
function getRelevantLocations(
  locations: AuthorizedLocationForClassification[],
  vehicleId?: string
): LocationWithRadius[] {
  return locations
    .filter((loc) => {
      // Include global locations
      if (loc.isGlobal) return true;
      // Include vehicle-specific locations
      if (vehicleId && loc.vehicleId === vehicleId) return true;
      return false;
    })
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      lat: loc.lat,
      lon: loc.lon,
      radiusKm: loc.radiusKm,
    }));
}

/**
 * Check if a point is within any authorized location
 */
function isPointAuthorized(
  lat: number,
  lon: number,
  locations: LocationWithRadius[]
): LocationWithRadius | null {
  return findMatchingLocation({ lat, lon }, locations);
}

/**
 * Classify a single trip
 *
 * @param trip - Trip to classify
 * @param authorizedLocations - List of authorized locations
 * @param vehicleId - Optional vehicle ID for vehicle-specific overrides
 * @returns Classification result
 */
export function classifyTrip(
  trip: TripForClassification,
  authorizedLocations: AuthorizedLocationForClassification[],
  vehicleId?: string
): ClassificationResult {
  // Get relevant locations for this vehicle
  const relevantLocations = getRelevantLocations(authorizedLocations, vehicleId);

  // Check if start or end point is within authorized area
  const startAuthorized = isPointAuthorized(trip.startLat, trip.startLon, relevantLocations);
  const endAuthorized = isPointAuthorized(trip.endLat, trip.endLon, relevantLocations);

  // Trip is authorized if either start or end is in an authorized zone
  const isAuthorized = startAuthorized !== null || endAuthorized !== null;
  const classification: TripClassification = isAuthorized ? 'AUTHORIZED' : 'UNAUTHORIZED';

  // Get time category
  const timeCategory = getTimeCategory(trip.startTime);

  // Get day type
  const dayType = getDayType(trip.startTime);

  // Check for work hours violation
  // Violation = unauthorized location during work hours
  const isWorkHoursViolation = !isAuthorized && isWorkHours(trip.startTime);

  // Find nearest authorized location for reference
  const nearest = findNearestLocation(
    { lat: trip.startLat, lon: trip.startLon },
    relevantLocations
  );

  const nearestAuthLocation = startAuthorized?.name || endAuthorized?.name || nearest?.location.name || null;
  const distanceFromAuthKm = startAuthorized
    ? 0
    : endAuthorized
    ? 0
    : nearest?.distanceKm || null;

  return {
    classification,
    timeCategory,
    dayType,
    isWorkHoursViolation,
    nearestAuthLocation,
    distanceFromAuthKm,
  };
}

/**
 * Classify a full GPS trip and return ClassifiedTrip
 *
 * @param trip - GPS trip to classify
 * @param authorizedLocations - List of authorized locations
 * @param vehicleId - Optional vehicle ID for vehicle-specific overrides
 * @returns Classified trip with all enrichment data
 */
export function classifyGPSTrip(
  trip: GPSTrip,
  authorizedLocations: AuthorizedLocationForClassification[],
  vehicleId?: string
): ClassifiedTrip {
  const result = classifyTrip(
    {
      startLat: trip.startLat,
      startLon: trip.startLon,
      endLat: trip.endLat,
      endLon: trip.endLon,
      startTime: trip.startTime,
    },
    authorizedLocations,
    vehicleId
  );

  return {
    ...trip,
    classification: result.classification,
    timeCategory: result.timeCategory,
    dayType: result.dayType,
    isWorkHoursViolation: result.isWorkHoursViolation,
    nearestAuthLocation: result.nearestAuthLocation,
    distanceFromAuthKm: result.distanceFromAuthKm,
    pois: [], // POIs added separately by enrichment service
  };
}

/**
 * Classify multiple trips
 *
 * @param trips - Array of GPS trips to classify
 * @param authorizedLocations - List of authorized locations
 * @param vehicleId - Optional vehicle ID for vehicle-specific overrides
 * @returns Array of classified trips
 */
export function classifyTrips(
  trips: GPSTrip[],
  authorizedLocations: AuthorizedLocationForClassification[],
  vehicleId?: string
): ClassifiedTrip[] {
  return trips.map((trip) => classifyGPSTrip(trip, authorizedLocations, vehicleId));
}
