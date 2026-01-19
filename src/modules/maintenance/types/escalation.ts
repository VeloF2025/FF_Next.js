/**
 * Ticketing Module - Repeat Fault Escalation Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for repeat fault detection, escalation
 * management, and infrastructure-level ticket creation.
 */

/**
 * Escalation Scope Type
 * Level at which faults are being tracked for escalation
 */
export enum EscalationScopeType {
  POLE = 'pole',
  PON = 'pon',
  ZONE = 'zone',
  DR = 'dr',
}

/**
 * Escalation Type
 * Type of investigation or action required
 */
export enum EscalationType {
  INVESTIGATION = 'investigation',
  INSPECTION = 'inspection',
  REPLACEMENT = 'replacement',
}

/**
 * Escalation Status
 */
export enum EscalationStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  NO_ACTION = 'no_action',
}

/**
 * Repeat Fault Escalation Interface
 * Tracks infrastructure-level escalations when fault patterns detected
 */
export interface RepeatFaultEscalation {
  // Primary identification
  id: string; // UUID

  // Escalation scope
  scope_type: EscalationScopeType;
  scope_value: string; // The pole number, PON, zone ID, or DR
  project_id: string | null; // UUID reference to projects

  // Trigger information
  fault_count: number; // Number of faults that triggered escalation
  fault_threshold: number; // Threshold that was exceeded
  contributing_tickets: string[]; // JSONB array of ticket IDs

  // Escalation details
  escalation_ticket_id: string | null; // UUID - The infrastructure ticket created
  escalation_type: EscalationType | null;

  // Status tracking
  status: EscalationStatus;
  resolution_notes: string | null;
  resolved_at: Date | null;
  resolved_by: string | null; // UUID reference to users

  // Timestamp
  created_at: Date;
}

/**
 * Create escalation payload
 */
export interface CreateEscalationPayload {
  scope_type: EscalationScopeType;
  scope_value: string;
  project_id?: string;
  fault_count: number;
  fault_threshold: number;
  contributing_tickets: string[]; // Array of ticket IDs
  escalation_type?: EscalationType;
}

/**
 * Update escalation payload
 */
export interface UpdateEscalationPayload {
  status?: EscalationStatus;
  escalation_ticket_id?: string;
  escalation_type?: EscalationType;
  resolution_notes?: string;
}

/**
 * Resolve escalation payload
 */
export interface ResolveEscalationPayload {
  resolved_by: string; // User ID
  resolution_notes: string;
  status: EscalationStatus.RESOLVED | EscalationStatus.NO_ACTION;
}

/**
 * Fault pattern detection result
 */
export interface FaultPatternDetectionResult {
  pattern_detected: boolean;
  scope_type: EscalationScopeType;
  scope_value: string;
  fault_count: number;
  threshold: number;
  contributing_tickets: ContributingTicket[];
  should_escalate: boolean;
  existing_escalation_id: string | null;
  recommendation: string;
}

/**
 * Contributing ticket summary
 */
export interface ContributingTicket {
  ticket_id: string;
  ticket_uid: string;
  created_at: Date;
  fault_cause: string | null;
  status: string;
}

/**
 * Escalation filters for listing
 */
export interface EscalationFilters {
  scope_type?: EscalationScopeType | EscalationScopeType[];
  status?: EscalationStatus | EscalationStatus[];
  project_id?: string;
  escalation_type?: EscalationType;
  created_after?: Date;
  created_before?: Date;
}

/**
 * Escalation list response
 */
export interface EscalationListResponse {
  escalations: RepeatFaultEscalation[];
  total: number;
  by_scope: Record<EscalationScopeType, number>;
  by_status: Record<EscalationStatus, number>;
}

/**
 * Escalation detail with related data
 */
export interface EscalationWithDetails extends RepeatFaultEscalation {
  contributing_ticket_details: ContributingTicket[];
  escalation_ticket?: {
    id: string;
    ticket_uid: string;
    title: string;
    status: string;
  };
  project?: {
    id: string;
    name: string;
  };
}

/**
 * Fault pattern configuration
 * Thresholds for triggering escalations
 */
export interface FaultPatternThresholds {
  pole_threshold: number; // e.g., 3 faults on same pole
  pon_threshold: number; // e.g., 5 faults on same PON
  zone_threshold: number; // e.g., 10 faults in same zone
  dr_threshold: number; // e.g., 2 faults on same DR
  time_window_days: number; // e.g., 30 days
}

/**
 * Pattern check input
 */
export interface PatternCheckInput {
  scope_type: EscalationScopeType;
  scope_value: string;
  project_id?: string;
  time_window_days?: number;
}

/**
 * Escalation statistics
 */
export interface EscalationStats {
  total_escalations: number;
  active_escalations: number;
  resolved_escalations: number;
  by_scope_type: Record<EscalationScopeType, number>;
  by_escalation_type: Record<EscalationType, number>;
  avg_resolution_time_days: number;
  most_problematic_zones: string[];
  most_problematic_pons: string[];
}

/**
 * Repeat fault alert
 */
export interface RepeatFaultAlert {
  escalation_id: string;
  scope_type: EscalationScopeType;
  scope_value: string;
  fault_count: number;
  severity: 'critical' | 'high' | 'medium';
  message: string;
  recommended_action: string;
  created_at: Date;
}
