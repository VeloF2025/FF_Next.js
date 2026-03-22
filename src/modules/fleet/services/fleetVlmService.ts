/**
 * Fleet VLM Service — Barrel Re-export
 *
 * This file has been refactored into focused modules.
 * All original exports are re-exported here for backwards compatibility.
 *
 * Sub-modules:
 * - fleetVlmClient.ts      — HTTP client, image resize, error class, health check
 * - odometerExtractor.ts   — Odometer reading, calibration, multi-pass
 * - odometerValidator.ts   — Odometer validation, digit confusion, discrepancy check
 * - fuelExtractor.ts       — Fuel gauge + receipt extraction, calibration
 * - vehicleDocExtractor.ts — License plate, licence disk, check-in dispatcher
 *
 * Status: WORKING — barrel only, zero logic here
 * NLNH Confidence: HIGH
 */

// Client utilities and shared types
export {
  FleetVlmError,
  VLM_API_BASE,
  getVehicleCalibration,
  checkFleetVlmHealth,
  updateCalibrationLearningStatus,
} from './fleetVlmClient';
export type { VehicleCalibration } from './fleetVlmClient';

// Odometer extraction
export {
  extractOdometerReading,
  extractOdometerWithCalibration,
  extractAndValidateOdometerReading,
} from './odometerExtractor';

// Odometer validation
export {
  validateOdometerReading,
  checkOdometerDiscrepancy,
  detectDigitConfusion,
} from './odometerValidator';
export type { OdometerValidationResult } from './odometerValidator';

// Fuel
export {
  extractFuelLevel,
  extractFuelLevelWithCalibration,
  extractFuelReceipt,
  getFuelLevelDescription,
} from './fuelExtractor';

// Vehicle documents + dispatcher
export {
  verifyLicensePlate,
  extractLicenseDiskDetails,
  processCheckInPhoto,
} from './vehicleDocExtractor';
