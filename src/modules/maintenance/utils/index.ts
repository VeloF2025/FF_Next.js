// 🟢 WORKING: Utility functions for FibreFlow Ticketing Module
// This file exports all utility functions for the ticketing module

// Database connection utility (subtask 1.4) ✅
export { db, getConnection, query, queryOne, transaction, healthCheck, closeConnection } from './db';
export type { HealthCheckResult } from './db';

// QA Readiness Validator (subtask 2.1) ✅
export { validateQAReadiness } from './qaReadinessValidator';
export type {
  QAReadinessValidationInput,
  QAReadinessValidationResult,
  PlatformData
} from './qaReadinessValidator';

// Fault Pattern Detector (subtask 3.1) ✅
export { detectFaultPattern, checkMultiplePatterns, getDefaultThresholds } from './faultPatternDetector';
export type {
  FaultPatternDetectorInput,
  FaultPatternThresholdsConfig,
  MultiplePatternCheckInput
} from './faultPatternDetector';

// Snapshot Generator (subtask 3.3) ✅
export { generateHandoverSnapshot } from './snapshotGenerator';
export type {
  GenerateSnapshotInput,
  GeneratedSnapshot
} from './snapshotGenerator';

// Guarantee Calculator (subtask 3.5) ✅
export {
  calculateGuaranteeExpiry,
  classifyGuaranteeStatus,
  determineBillingClassification,
  assessContractorLiability
} from './guaranteeCalculator';
export type {
  GuaranteeExpiryInput,
  GuaranteeExpiryResult,
  GuaranteeClassificationInput,
  GuaranteeClassificationResult,
  BillingDeterminationInput,
  BillingDeterminationResult,
  ContractorLiabilityInput,
  ContractorLiabilityAssessmentResult
} from './guaranteeCalculator';

// Excel Parser (subtask 5.1) ✅
export {
  parseExcelFile,
  validateRow,
  detectDuplicates,
  generatePreview,
  createDefaultColumnMapping,
  mapRowToTicket
} from './excelParser';
export type {
  ExcelParseOptions,
  ExcelParseResult,
  ValidationResult,
  DuplicateResult,
  PreviewOptions
} from './excelParser';

// SLA Calculator (subtask 5.8) ✅
export {
  calculateSLACompliance,
  isTicketOverdue,
  calculateResolutionTime,
  calculateSLATimeRemaining
} from './slaCalculator';
export type {
  SLAComplianceInput,
  SLAComplianceResult,
  OverdueCheckInput,
  OverdueCheckResult,
  SLATimeRemainingInput,
  SLATimeRemainingResult,
  ResolutionTimeInput,
  ResolutionTimeResult
} from './slaCalculator';

// Utilities to be added in future subtasks:
// - drLookup.ts - DR number lookup helpers
