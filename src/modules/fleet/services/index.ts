/**
 * Fleet Module Services
 * Re-export all service functions
 */

// GPS Parser
export { parseGPSExcel, extractTripsFromPoints, parseEventType, fuzzyMatchColumn } from './gpsParser';

// Trip Classifier
export { classifyTrip, classifyGPSTrip, classifyTrips } from './tripClassifier';
export type {
  TripForClassification,
  AuthorizedLocationForClassification,
  ClassificationResult,
} from './tripClassifier';

// Cost Calculator
export {
  calculateTripCost,
  calculateTotalCosts,
  formatCurrency,
  DEFAULT_FUEL_RATE,
  DEFAULT_DEPRECIATION_RATE,
} from './costCalculator';
export type { TripForCost, TripCostResult, TotalCostResult } from './costCalculator';

// Pattern Detector
export { detectPatterns } from './patternDetector';
export type { ClassifiedTripForPattern } from './patternDetector';
