/**
 * QA Auto-Fail Service — Barrel Re-export
 *
 * This file has been refactored into focused modules.
 * All original exports are re-exported here for backwards compatibility.
 *
 * Sub-modules:
 * - autoFailTypes.ts       — Shared type definitions (no logic)
 * - serialValidator.ts     — Fuzzy matching, format validation, masking, type detection
 * - serialFeedback.ts      — Human-readable status strings and WA feedback formatting
 * - drValidationEngine.ts  — Prerequisites, step coverage, serial cross-ref, power meter
 * - autoFailEvaluation.ts  — Final decision logic, technician issues, descriptions
 *
 * Status: WORKING — barrel only, zero logic here
 * NLNH Confidence: HIGH
 */

// Shared types
export type {
  FailReasonCode,
  TechnicianIssueCode,
  TechnicianIssue,
  PrerequisitesResult,
  StepCoverageResult,
  PowerMeterResult,
  SerialValidationResult,
  AutoFailResult,
  DrValidationData,
} from './autoFailTypes';

// Fuzzy matching + serial format validation
export {
  fuzzySerialMatch,
  serialsMatchFuzzy,
  validateOntSerial,
  validateUpsSerial,
  looksLikeOntSerial,
  looksLikeGizzuSerial,
  detectSwappedSerials,
  maskSerial,
  getSerialStatus,
  formatSerialFeedback,
} from './serialValidator';
export type { FuzzyMatchResult, SerialStatus } from './serialValidator';

// DR validation engine
export {
  validatePowerMeter,
  checkPrerequisites,
  checkStepCoverage,
  validateSerialCrossReference,
} from './drValidationEngine';

// Auto-fail decision + technician feedback helpers
export {
  evaluateAutoFail,
  getFailReasonDescription,
  formatStepCoverage,
  getTechnicianIssues,
  getTechnicianIssueDescription,
} from './autoFailEvaluation';
