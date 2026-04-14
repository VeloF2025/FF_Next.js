/**
 * Health & Safety Module - Type Exports
 *
 * Note: Some modules have duplicate exported names. We use selective
 * re-exports to resolve ambiguity (TS2308).
 */

// Checklist types (canonical SEVERITY_CONFIG comes from here)
export * from './checklist.types';

// Audit types (canonical AuditScoreResult comes from here)
export * from './audit.types';

// Compliance types
export * from './compliance.types';

// Scoring types — exclude AuditScoreResult (already from audit.types)
export {
  type HSScoreInput,
  type HSScoreResult,
  type AuditScoreInput,
  type HSDashboardStats,
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
} from './scoring.types';

// Ticket types — exclude SEVERITY_CONFIG (already from checklist.types)
export {
  type HSIncidentType,
  type HSSeverity,
  type PersonInvolved,
  type IncidentGPS,
  type HSTicketDetails,
  type HSTicketDetailsInput,
  SEVERITY_TO_PRIORITY,
  SEVERITY_SLA_HOURS,
  INCIDENT_TYPE_CONFIG,
} from './ticket.types';

// CAPA types
export * from './capa.types';

// Risk types
export * from './risk.types';
