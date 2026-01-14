/**
 * Pattern Detector Service
 * Detects suspicious patterns in classified trip data
 */

import type {
  TripClassification,
  TimeCategory,
  DayType,
  RiskLevel,
  DetectedPattern,
  PatternType,
  PatternSeverity,
} from '../types';
import { calculateTotalCosts, DEFAULT_FUEL_RATE, DEFAULT_DEPRECIATION_RATE } from './costCalculator';

/**
 * Minimum trip data needed for pattern detection
 */
export interface ClassifiedTripForPattern {
  id: string;
  classification: TripClassification;
  dayType: DayType;
  timeCategory: TimeCategory;
  distanceKm: number;
  isWorkHoursViolation: boolean;
  pois: Array<{
    category: string;
    name: string;
    isSuspicious: boolean;
    riskLevel: RiskLevel;
    distanceMeters: number;
  }>;
  startTime?: Date;
  endTime?: Date;
}

/**
 * Pattern detection thresholds
 */
const THRESHOLDS = {
  // Minimum trips to consider a pattern
  MIN_WEEKEND_TRIPS: 1,
  MIN_AFTER_HOURS_TRIPS: 1,
  MIN_NIGHT_TRIPS: 1,
  MIN_WORK_VIOLATIONS: 1,
  // Consecutive nights for critical alert
  CRITICAL_CONSECUTIVE_NIGHTS: 3,
};

/**
 * Detect all patterns in a set of classified trips
 */
export function detectPatterns(
  trips: ClassifiedTripForPattern[],
  fuelRate: number = DEFAULT_FUEL_RATE,
  depreciationRate: number = DEFAULT_DEPRECIATION_RATE
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Filter to unauthorized trips only (authorized trips are normal)
  const unauthorizedTrips = trips.filter((t) => t.classification === 'UNAUTHORIZED');

  if (unauthorizedTrips.length === 0) {
    return patterns;
  }

  // Detect weekend usage
  const weekendPattern = detectWeekendUsage(unauthorizedTrips, fuelRate, depreciationRate);
  if (weekendPattern) patterns.push(weekendPattern);

  // Detect after-hours usage
  const afterHoursPattern = detectAfterHours(unauthorizedTrips, fuelRate, depreciationRate);
  if (afterHoursPattern) patterns.push(afterHoursPattern);

  // Detect night travel
  const nightPattern = detectNightTravel(unauthorizedTrips, fuelRate, depreciationRate);
  if (nightPattern) patterns.push(nightPattern);

  // Detect suspicious POI visits
  const poiPatterns = detectSuspiciousPOI(unauthorizedTrips, fuelRate, depreciationRate);
  patterns.push(...poiPatterns);

  // Detect work hours violations
  const violationPattern = detectWorkHoursViolations(unauthorizedTrips, fuelRate, depreciationRate);
  if (violationPattern) patterns.push(violationPattern);

  // Detect consecutive unauthorized nights
  const consecutivePattern = detectConsecutiveUnauthorizedNights(unauthorizedTrips, fuelRate, depreciationRate);
  if (consecutivePattern) patterns.push(consecutivePattern);

  return patterns;
}

/**
 * Detect weekend usage pattern
 */
function detectWeekendUsage(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern | null {
  const weekendTrips = trips.filter((t) => t.dayType === 'WEEKEND');

  if (weekendTrips.length < THRESHOLDS.MIN_WEEKEND_TRIPS) {
    return null;
  }

  const costs = calculateTotalCosts(
    weekendTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
    fuelRate,
    depreciationRate
  );

  return {
    type: 'WEEKEND_USAGE',
    severity: weekendTrips.length >= 5 ? 'HIGH' : 'MEDIUM',
    description: `${weekendTrips.length} unauthorized weekend trips detected`,
    count: weekendTrips.length,
    trips: weekendTrips.map((t) => t.id),
    totalKm: costs.totalKm,
    totalCost: costs.totalCost,
  };
}

/**
 * Detect after-hours usage pattern
 */
function detectAfterHours(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern | null {
  const afterHoursTrips = trips.filter((t) => t.timeCategory === 'AFTER_HOURS');

  if (afterHoursTrips.length < THRESHOLDS.MIN_AFTER_HOURS_TRIPS) {
    return null;
  }

  const costs = calculateTotalCosts(
    afterHoursTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
    fuelRate,
    depreciationRate
  );

  return {
    type: 'AFTER_HOURS',
    severity: afterHoursTrips.length >= 5 ? 'MEDIUM' : 'LOW',
    description: `${afterHoursTrips.length} after-hours trips detected`,
    count: afterHoursTrips.length,
    trips: afterHoursTrips.map((t) => t.id),
    totalKm: costs.totalKm,
    totalCost: costs.totalCost,
  };
}

/**
 * Detect night travel pattern
 */
function detectNightTravel(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern | null {
  const nightTrips = trips.filter((t) => t.timeCategory === 'NIGHT_TRAVEL');

  if (nightTrips.length < THRESHOLDS.MIN_NIGHT_TRIPS) {
    return null;
  }

  const costs = calculateTotalCosts(
    nightTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
    fuelRate,
    depreciationRate
  );

  return {
    type: 'NIGHT_TRAVEL',
    severity: nightTrips.length >= 3 ? 'HIGH' : 'MEDIUM',
    description: `${nightTrips.length} night travel instances (22:00-05:00)`,
    count: nightTrips.length,
    trips: nightTrips.map((t) => t.id),
    totalKm: costs.totalKm,
    totalCost: costs.totalCost,
  };
}

/**
 * Detect suspicious POI visits
 */
function detectSuspiciousPOI(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  // Group by POI category
  const poiVisits: Record<
    string,
    { trips: ClassifiedTripForPattern[]; maxRisk: RiskLevel }
  > = {};

  for (const trip of trips) {
    for (const poi of trip.pois) {
      if (poi.isSuspicious) {
        const category = poi.category.toLowerCase();
        if (!poiVisits[category]) {
          poiVisits[category] = { trips: [], maxRisk: 'LOW' };
        }
        poiVisits[category].trips.push(trip);

        // Track highest risk level
        const riskOrder: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        const currentIdx = riskOrder.indexOf(poiVisits[category].maxRisk);
        const newIdx = riskOrder.indexOf(poi.riskLevel);
        if (newIdx > currentIdx) {
          poiVisits[category].maxRisk = poi.riskLevel;
        }
      }
    }
  }

  // Create patterns for each POI category
  for (const [category, data] of Object.entries(poiVisits)) {
    const costs = calculateTotalCosts(
      data.trips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
      fuelRate,
      depreciationRate
    );

    const severity = riskToSeverity(data.maxRisk);

    patterns.push({
      type: 'SUSPICIOUS_POI',
      severity,
      description: `${data.trips.length} visits near ${category} locations`,
      count: data.trips.length,
      trips: data.trips.map((t) => t.id),
      totalKm: costs.totalKm,
      totalCost: costs.totalCost,
    });
  }

  return patterns;
}

/**
 * Detect work hours violations
 */
function detectWorkHoursViolations(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern | null {
  const violationTrips = trips.filter((t) => t.isWorkHoursViolation);

  if (violationTrips.length < THRESHOLDS.MIN_WORK_VIOLATIONS) {
    return null;
  }

  const costs = calculateTotalCosts(
    violationTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
    fuelRate,
    depreciationRate
  );

  return {
    type: 'WORK_HOURS_VIOLATION',
    severity: 'HIGH',
    description: `${violationTrips.length} work hours violations (unauthorized location during work hours)`,
    count: violationTrips.length,
    trips: violationTrips.map((t) => t.id),
    totalKm: costs.totalKm,
    totalCost: costs.totalCost,
  };
}

/**
 * Detect consecutive unauthorized nights
 */
function detectConsecutiveUnauthorizedNights(
  trips: ClassifiedTripForPattern[],
  fuelRate: number,
  depreciationRate: number
): DetectedPattern | null {
  // Filter night trips with start times
  const nightTrips = trips
    .filter((t) => t.timeCategory === 'NIGHT_TRAVEL' && t.startTime)
    .sort((a, b) => a.startTime!.getTime() - b.startTime!.getTime());

  if (nightTrips.length < THRESHOLDS.CRITICAL_CONSECUTIVE_NIGHTS) {
    return null;
  }

  // Count consecutive nights
  const firstNightTrip = nightTrips[0];
  if (!firstNightTrip) return null;

  let maxConsecutive = 1;
  let currentConsecutive = 1;
  let consecutiveTrips: ClassifiedTripForPattern[] = [firstNightTrip];
  let maxConsecutiveTrips: ClassifiedTripForPattern[] = [firstNightTrip];

  for (let i = 1; i < nightTrips.length; i++) {
    const prevTrip = nightTrips[i - 1];
    const currTrip = nightTrips[i];
    if (!prevTrip || !currTrip || !prevTrip.startTime || !currTrip.startTime) continue;

    const prevDate = prevTrip.startTime;
    const currDate = currTrip.startTime;

    // Check if consecutive days (within 48 hours to account for timing differences)
    const daysDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff <= 2) {
      currentConsecutive++;
      consecutiveTrips.push(currTrip);

      if (currentConsecutive > maxConsecutive) {
        maxConsecutive = currentConsecutive;
        maxConsecutiveTrips = [...consecutiveTrips];
      }
    } else {
      currentConsecutive = 1;
      consecutiveTrips = [currTrip];
    }
  }

  if (maxConsecutive < THRESHOLDS.CRITICAL_CONSECUTIVE_NIGHTS) {
    return null;
  }

  const costs = calculateTotalCosts(
    maxConsecutiveTrips.map((t) => ({ distanceKm: t.distanceKm, classification: t.classification })),
    fuelRate,
    depreciationRate
  );

  return {
    type: 'CONSECUTIVE_UNAUTHORIZED_NIGHTS',
    severity: maxConsecutive >= 6 ? 'CRITICAL' : 'HIGH',
    description: `${maxConsecutive} consecutive unauthorized nights detected`,
    count: maxConsecutive,
    trips: maxConsecutiveTrips.map((t) => t.id),
    totalKm: costs.totalKm,
    totalCost: costs.totalCost,
  };
}

/**
 * Convert risk level to pattern severity
 */
function riskToSeverity(risk: RiskLevel): PatternSeverity {
  switch (risk) {
    case 'CRITICAL':
      return 'CRITICAL';
    case 'HIGH':
      return 'HIGH';
    case 'MEDIUM':
      return 'MEDIUM';
    case 'LOW':
    default:
      return 'LOW';
  }
}
