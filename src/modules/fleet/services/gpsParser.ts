/**
 * GPS Parser Service
 * Parses GPS tracking Excel files and extracts trips
 */

import * as XLSX from 'xlsx';
import type {
  GPSPoint,
  GPSTrip,
  GPSEventType,
  GPSParseResult,
  VehicleInfo,
  ColumnMapping,
} from '../types';
import { haversineDistance, calculateRouteDistance } from '../utils/geoUtils';
import { parseExcelDate } from '../utils/excelDateParser';
import { getDurationMinutes } from '../utils/dateUtils';

/**
 * Column name mappings for fuzzy matching
 */
const COLUMN_MAPPINGS: Record<string, string[]> = {
  date: ['date', 'datetime', 'timestamp', 'time', 'gps date', 'gps time'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'long', 'lng', 'lon', 'x'],
  location: ['location', 'address', 'place', 'position'],
  speed: ['speed', 'velocity', 'km/h', 'kph'],
  odometer: ['odometer', 'mileage', 'km', 'distance', 'odo'],
  fuel: ['fuel', 'fuel level', 'tank', 'litres', 'liters'],
  eventType: ['case', 'event', 'type', 'status', 'ignition', 'event type'],
};

/**
 * Parse event type string to GPSEventType enum
 */
export function parseEventType(value: string | null | undefined): GPSEventType {
  if (!value) return 'UNKNOWN';

  const normalized = value.toString().toLowerCase().trim();

  if (normalized.includes('ignition on') || normalized === 'ignition on') {
    return 'IGNITION_ON';
  }

  if (normalized.includes('ignition off') || normalized === 'ignition off') {
    return 'IGNITION_OFF';
  }

  if (
    normalized.includes('driving') ||
    normalized.includes('moving') ||
    normalized.includes('motion')
  ) {
    return 'MOVEMENT';
  }

  if (
    normalized.includes('stop') ||
    normalized.includes('stationary') ||
    normalized.includes('parked')
  ) {
    return 'STOP';
  }

  if (normalized.includes('idle') || normalized.includes('idling')) {
    return 'IDLE';
  }

  return 'UNKNOWN';
}

/**
 * Fuzzy match column name to target field
 */
export function fuzzyMatchColumn(columnName: string, targetField: string): boolean {
  const normalizedColumn = columnName.toLowerCase().trim();
  const patterns = COLUMN_MAPPINGS[targetField];

  if (!patterns) return false;

  return patterns.some((pattern) => {
    // Exact match
    if (normalizedColumn === pattern) return true;
    // Starts with pattern
    if (normalizedColumn.startsWith(pattern)) return true;
    // Contains pattern
    if (normalizedColumn.includes(pattern)) return true;
    return false;
  });
}

/**
 * Find column mapping from header row
 */
function findColumnMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    date: null,
    latitude: null,
    longitude: null,
    location: null,
    speed: null,
    odometer: null,
    fuel: null,
    eventType: null,
  };

  headers.forEach((header, index) => {
    if (!header) return;

    for (const field of Object.keys(mapping) as Array<keyof ColumnMapping>) {
      if (mapping[field] === null && fuzzyMatchColumn(header, field)) {
        mapping[field] = index;
        break;
      }
    }
  });

  return mapping;
}

/**
 * Extract vehicle info from Excel header rows
 */
function extractVehicleInfo(worksheet: XLSX.WorkSheet): VehicleInfo | null {
  // Try to find vehicle info in first 10 rows
  for (let row = 1; row <= 10; row++) {
    const cellA = worksheet[`A${row}`];
    const cellB = worksheet[`B${row}`];
    const cellC = worksheet[`C${row}`];

    if (cellA?.v && typeof cellA.v === 'string') {
      const text = cellA.v.toLowerCase();

      // Look for registration
      if (text.includes('reg') || text.includes('vehicle')) {
        const regMatch = cellB?.v?.toString().match(/[A-Z]{2,3}\s*\d{2,3}\s*[A-Z]{2,3}/i);
        if (regMatch) {
          return {
            registration: regMatch[0].replace(/\s/g, ' ').toUpperCase(),
            make: cellC?.v?.toString() || null,
            model: null,
          };
        }
      }
    }
  }

  return null;
}

/**
 * Parse GPS points from worksheet
 */
function parseGPSPoints(
  worksheet: XLSX.WorkSheet,
  mapping: ColumnMapping,
  headerRow: number
): { points: GPSPoint[]; errors: string[]; warnings: string[] } {
  const points: GPSPoint[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // Get worksheet range
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const startRow = headerRow + 1;

  for (let row = startRow; row <= range.e.r; row++) {
    try {
      // Get cell values
      const getCell = (colIndex: number | null): unknown => {
        if (colIndex === null) return null;
        const cellRef = XLSX.utils.encode_cell({ r: row, c: colIndex });
        return worksheet[cellRef]?.v;
      };

      const dateValue = getCell(mapping.date);
      const latValue = getCell(mapping.latitude);
      const lonValue = getCell(mapping.longitude);
      const eventValue = getCell(mapping.eventType);

      // Skip rows without required data
      if (!dateValue || !latValue || !lonValue) {
        continue;
      }

      // Parse date
      const timestamp = parseExcelDate(dateValue);
      if (!timestamp) {
        warnings.push(`Row ${row + 1}: Invalid date format`);
        continue;
      }

      // Parse coordinates
      const latitude = parseFloat(String(latValue));
      const longitude = parseFloat(String(lonValue));

      if (isNaN(latitude) || isNaN(longitude)) {
        warnings.push(`Row ${row + 1}: Invalid coordinates`);
        continue;
      }

      // Parse optional fields
      const location = getCell(mapping.location)?.toString() || null;
      const speed = mapping.speed !== null ? parseFloat(String(getCell(mapping.speed))) || null : null;
      const odometer = mapping.odometer !== null ? parseFloat(String(getCell(mapping.odometer))) || null : null;
      const fuel = mapping.fuel !== null ? parseFloat(String(getCell(mapping.fuel))) || null : null;
      const eventType = parseEventType(String(eventValue || ''));

      points.push({
        timestamp,
        latitude,
        longitude,
        location,
        speed,
        odometer,
        fuel,
        eventType,
      });
    } catch (e) {
      errors.push(`Row ${row + 1}: Parse error - ${e}`);
    }
  }

  return { points, errors, warnings };
}

/**
 * Extract trips from GPS points
 * A trip starts with IGNITION_ON and ends with IGNITION_OFF
 */
export function extractTripsFromPoints(points: GPSPoint[]): GPSTrip[] {
  const trips: GPSTrip[] = [];

  if (points.length === 0) return trips;

  // Sort points by timestamp
  const sortedPoints = [...points].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );

  let currentTrip: {
    startIndex: number;
    points: GPSPoint[];
  } | null = null;

  let tripNumber = 0;

  for (let i = 0; i < sortedPoints.length; i++) {
    const point = sortedPoints[i];
    if (!point) continue;

    if (point.eventType === 'IGNITION_ON') {
      // End previous trip if exists (consecutive IGNITION_ON)
      if (currentTrip !== null) {
        tripNumber++;
        const trip = buildTrip(tripNumber, currentTrip.points);
        if (trip) trips.push(trip);
      }

      // Start new trip
      currentTrip = {
        startIndex: i,
        points: [point],
      };
    } else if (point.eventType === 'IGNITION_OFF' && currentTrip !== null) {
      // End current trip
      currentTrip.points.push(point);
      tripNumber++;
      const trip = buildTrip(tripNumber, currentTrip.points);
      if (trip) trips.push(trip);
      currentTrip = null;
    } else if (currentTrip !== null) {
      // Add point to current trip
      currentTrip.points.push(point);
    }
  }

  // Handle unclosed trip at end
  if (currentTrip !== null && currentTrip.points.length > 1) {
    tripNumber++;
    const trip = buildTrip(tripNumber, currentTrip.points);
    if (trip) trips.push(trip);
  }

  return trips;
}

/**
 * Build a trip from points
 */
function buildTrip(tripNumber: number, points: GPSPoint[]): GPSTrip | null {
  if (points.length < 2) return null;

  const startPoint = points[0];
  const endPoint = points[points.length - 1];

  if (!startPoint || !endPoint) return null;

  // Calculate distance
  const routeCoords = points.map((p) => ({ lat: p.latitude, lon: p.longitude }));
  const distanceKm = calculateRouteDistance(routeCoords);

  // Calculate duration
  const durationMinutes = getDurationMinutes(startPoint.timestamp, endPoint.timestamp);

  return {
    tripNumber,
    startTime: startPoint.timestamp,
    endTime: endPoint.timestamp,
    durationMinutes,
    startLat: startPoint.latitude,
    startLon: startPoint.longitude,
    startLocation: startPoint.location,
    startOdometer: startPoint.odometer,
    endLat: endPoint.latitude,
    endLon: endPoint.longitude,
    endLocation: endPoint.location,
    endOdometer: endPoint.odometer,
    distanceKm,
    gpsPoints: points,
  };
}

/**
 * Parse GPS Excel file
 *
 * @param buffer - Excel file buffer
 * @returns Parse result with trips and metadata
 */
export async function parseGPSExcel(buffer: Buffer): Promise<GPSParseResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Read workbook
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (workbook.SheetNames.length === 0) {
      return {
        success: false,
        vehicleInfo: null,
        totalPoints: 0,
        trips: [],
        periodStart: null,
        periodEnd: null,
        errors: ['No sheets found in Excel file'],
        warnings: [],
      };
    }

    // Use first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return {
        success: false,
        vehicleInfo: null,
        totalPoints: 0,
        trips: [],
        periodStart: null,
        periodEnd: null,
        errors: ['No sheet name found in Excel file'],
        warnings: [],
      };
    }
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      return {
        success: false,
        vehicleInfo: null,
        totalPoints: 0,
        trips: [],
        periodStart: null,
        periodEnd: null,
        errors: ['Worksheet not found in Excel file'],
        warnings: [],
      };
    }

    // Extract vehicle info
    const vehicleInfo = extractVehicleInfo(worksheet);

    // Find header row (search first 15 rows)
    let headerRow = -1;
    let mapping: ColumnMapping | null = null;

    for (let row = 0; row < 15; row++) {
      const headers: string[] = [];
      for (let col = 0; col < 20; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = worksheet[cellRef];
        headers.push(cell?.v?.toString() || '');
      }

      const testMapping = findColumnMapping(headers);

      // Check if we found enough required columns
      if (
        testMapping.date !== null &&
        testMapping.latitude !== null &&
        testMapping.longitude !== null
      ) {
        headerRow = row;
        mapping = testMapping;
        break;
      }
    }

    if (headerRow === -1 || !mapping) {
      return {
        success: false,
        vehicleInfo,
        totalPoints: 0,
        trips: [],
        periodStart: null,
        periodEnd: null,
        errors: ['Could not find GPS data headers (Date, Latitude, Longitude)'],
        warnings: [],
      };
    }

    // Parse GPS points
    const parseResult = parseGPSPoints(worksheet, mapping, headerRow);
    errors.push(...parseResult.errors);
    warnings.push(...parseResult.warnings);

    if (parseResult.points.length === 0) {
      return {
        success: false,
        vehicleInfo,
        totalPoints: 0,
        trips: [],
        periodStart: null,
        periodEnd: null,
        errors: ['No GPS points found in file'],
        warnings,
      };
    }

    // Extract trips
    const trips = extractTripsFromPoints(parseResult.points);

    // Calculate period
    const sortedPoints = parseResult.points.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    const firstPoint = sortedPoints[0];
    const lastPoint = sortedPoints[sortedPoints.length - 1];
    const periodStart = firstPoint?.timestamp ?? null;
    const periodEnd = lastPoint?.timestamp ?? null;

    return {
      success: true,
      vehicleInfo,
      totalPoints: parseResult.points.length,
      trips,
      periodStart,
      periodEnd,
      errors,
      warnings,
    };
  } catch (e) {
    return {
      success: false,
      vehicleInfo: null,
      totalPoints: 0,
      trips: [],
      periodStart: null,
      periodEnd: null,
      errors: [`Failed to parse Excel file: ${e}`],
      warnings: [],
    };
  }
}

// Re-export GPSPoint type for tests
export type { GPSPoint };
