/**
 * GPS Types
 * Types for GPS tracking data parsing and trip classification
 */

/**
 * Raw GPS point from Excel import
 */
export interface GPSPoint {
  timestamp: Date;
  latitude: number;
  longitude: number;
  location: string | null;
  speed: number | null; // km/h
  odometer: number | null; // km
  fuel: number | null; // liters
  eventType: GPSEventType;
}

/**
 * GPS event types from tracking device
 */
export type GPSEventType =
  | 'IGNITION_ON'
  | 'IGNITION_OFF'
  | 'MOVEMENT'
  | 'STOP'
  | 'IDLE'
  | 'UNKNOWN';

/**
 * Parsed trip extracted from GPS points (Ignition On → Ignition Off)
 */
export interface GPSTrip {
  tripNumber: number;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;

  // Start location
  startLat: number;
  startLon: number;
  startLocation: string | null;
  startOdometer: number | null;

  // End location
  endLat: number;
  endLon: number;
  endLocation: string | null;
  endOdometer: number | null;

  // Distance
  distanceKm: number;

  // Raw GPS points for this trip (for map visualization)
  gpsPoints: GPSPoint[];
}

/**
 * Trip classification result
 */
export type TripClassification = 'AUTHORIZED' | 'UNAUTHORIZED';

/**
 * Time category for trip
 */
export type TimeCategory = 'WORK_HOURS' | 'AFTER_HOURS' | 'NIGHT_TRAVEL';

/**
 * Day type for trip
 */
export type DayType = 'WEEKDAY' | 'WEEKEND';

/**
 * Classified trip with all enrichment data
 */
export interface ClassifiedTrip extends GPSTrip {
  // Classification
  classification: TripClassification;
  timeCategory: TimeCategory;
  dayType: DayType;

  // Flags
  isWorkHoursViolation: boolean;

  // Nearest authorized location
  nearestAuthLocation: string | null;
  distanceFromAuthKm: number | null;

  // POI enrichment
  pois: TripPOI[];
}

/**
 * Point of Interest near a trip location
 */
export interface TripPOI {
  poiType: 'start' | 'end' | 'stop' | 'nearby';
  lat: number;
  lon: number;
  category: string;
  name: string;
  address: string | null;
  isSuspicious: boolean;
  riskLevel: RiskLevel;
  distanceMeters: number;
}

/**
 * Risk level for POI
 */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * GPS parsing result
 */
export interface GPSParseResult {
  success: boolean;
  vehicleInfo: VehicleInfo | null;
  totalPoints: number;
  trips: GPSTrip[];
  periodStart: Date | null;
  periodEnd: Date | null;
  errors: string[];
  warnings: string[];
}

/**
 * Vehicle info extracted from Excel header
 */
export interface VehicleInfo {
  registration: string | null;
  make: string | null;
  model: string | null;
}

/**
 * Excel column mapping (fuzzy matching)
 */
export interface ColumnMapping {
  date: number | null;
  latitude: number | null;
  longitude: number | null;
  location: number | null;
  speed: number | null;
  odometer: number | null;
  fuel: number | null;
  eventType: number | null;
}

/**
 * Authorized location for geofencing
 */
export interface AuthorizedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  locationType: LocationType;
  isGlobal: boolean;
  vehicleId: string | null;
  isActive: boolean;
}

/**
 * Location type options
 */
export type LocationType = 'work_site' | 'accommodation' | 'supplier' | 'client' | 'office' | 'depot' | 'other';

/**
 * Database row types
 */
export interface FleetAuthorizedLocationRow {
  id: string;
  name: string;
  lat: string;
  lon: string;
  radius_km: string;
  location_type: string | null;
  is_global: boolean;
  vehicle_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to AuthorizedLocation
 */
export function rowToAuthorizedLocation(row: FleetAuthorizedLocationRow): AuthorizedLocation {
  return {
    id: row.id,
    name: row.name,
    lat: parseFloat(row.lat),
    lon: parseFloat(row.lon),
    radiusKm: parseFloat(row.radius_km),
    locationType: row.location_type as LocationType,
    isGlobal: row.is_global,
    vehicleId: row.vehicle_id,
    isActive: row.is_active,
  };
}

/**
 * Create authorized location request
 */
export interface CreateAuthorizedLocationRequest {
  name: string;
  lat: number;
  lon: number;
  radiusKm?: number;
  locationType?: LocationType;
  isGlobal?: boolean;
  vehicleId?: string;
}
