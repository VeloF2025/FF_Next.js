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

// Fleet Analytics Service
export {
  fleetAnalyticsService,
  getFleetKPIs,
  getTCOReport,
  getCostTrends,
  generateDailySnapshot,
  getDriverCompliance,
  getUpcomingServices,
} from './fleetAnalyticsService';

// Maintenance Service
export {
  maintenanceService,
  getServiceIntervals,
  getServiceInterval,
  createServiceInterval,
  updateServiceInterval,
  deleteServiceInterval,
  getServiceHistory,
  recordService,
  getUpcomingServices as getMaintenanceUpcoming,
} from './maintenanceService';

// Driver Score Service
export {
  driverScoreService,
  calculateDriverScore,
  calculateAllDriverScores,
  getLeaderboard,
  getDriverScorecard,
} from './driverScoreService';

// Scorecard Service
export {
  fleetScorecardService,
  getVehicleScorecard,
} from './fleetScorecardService';

// Mileage Service
export {
  fleetMileageService,
  getFleetMileage,
  getProjectMileageSummaries,
} from './fleetMileageService';

// Fuel Analytics Service
export {
  fuelAnalyticsService,
  getFuelTransactions,
  getFleetFuelSummary,
  getVehicleFuelStats,
  getFuelEfficiencyTrends,
  getFuelCostBreakdown,
  runAnomalyDetection,
  getFuelAnomalies,
  updateAnomalyStatus,
} from './fuelAnalyticsService';
