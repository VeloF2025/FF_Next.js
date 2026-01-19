/**
 * Ticketing Module - Risk Acceptance Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for QA risk acceptances - conditional
 * approvals with documented exceptions and expiry tracking.
 */

/**
 * Risk Acceptance Status
 */
export enum RiskAcceptanceStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  EXPIRED = 'expired',
  ESCALATED = 'escalated',
}

/**
 * Risk Type Categories
 */
export enum RiskType {
  MINOR_DEFECT = 'minor_defect',
  DOCUMENTATION_GAP = 'documentation_gap',
  PENDING_MATERIAL = 'pending_material',
  TEMPORARY_FIX = 'temporary_fix',
  COSMETIC_ISSUE = 'cosmetic_issue',
  CLIENT_REQUESTED = 'client_requested',
  WEATHER_DEPENDENT = 'weather_dependent',
  PENDING_THIRD_PARTY = 'pending_third_party',
  OTHER = 'other',
}

/**
 * QA Risk Acceptance Interface
 * Allows conditional QA approval with documented exceptions
 */
export interface QARiskAcceptance {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets

  // Risk details
  risk_type: RiskType;
  risk_description: string;
  conditions: string | null; // What must be resolved

  // Expiry tracking
  risk_expiry_date: Date | null; // When condition must be resolved
  requires_followup: boolean;
  followup_date: Date | null;

  // Status tracking
  status: RiskAcceptanceStatus;
  resolved_at: Date | null;
  resolved_by: string | null; // UUID reference to users
  resolution_notes: string | null;

  // Approval tracking
  accepted_by: string; // UUID reference to users (NOT NULL)
  accepted_at: Date;

  // Timestamp
  created_at: Date;
}

/**
 * Create risk acceptance payload
 */
export interface CreateRiskAcceptancePayload {
  ticket_id: string;
  risk_type: RiskType;
  risk_description: string;
  conditions?: string;
  risk_expiry_date?: Date;
  requires_followup?: boolean;
  followup_date?: Date;
  accepted_by: string; // User ID who accepted the risk
}

/**
 * Update risk acceptance payload
 */
export interface UpdateRiskAcceptancePayload {
  status?: RiskAcceptanceStatus;
  risk_description?: string;
  conditions?: string;
  risk_expiry_date?: Date;
  followup_date?: Date;
  resolution_notes?: string;
}

/**
 * Resolve risk acceptance payload
 */
export interface ResolveRiskAcceptancePayload {
  resolved_by: string; // User ID
  resolution_notes: string;
}

/**
 * Risk acceptance summary for a ticket
 */
export interface TicketRiskSummary {
  ticket_id: string;
  total_risks: number;
  active_risks: number;
  resolved_risks: number;
  expired_risks: number;
  escalated_risks: number;
  has_blocking_risks: boolean;
  can_close_ticket: boolean;
  risks: QARiskAcceptance[];
}

/**
 * Risk expiry warning
 */
export interface RiskExpiryWarning {
  risk_id: string;
  ticket_id: string;
  ticket_uid: string;
  risk_type: RiskType;
  risk_description: string;
  expiry_date: Date;
  days_until_expiry: number;
  is_expired: boolean;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * Risk acceptance filters for listing
 */
export interface RiskAcceptanceFilters {
  ticket_id?: string;
  status?: RiskAcceptanceStatus | RiskAcceptanceStatus[];
  risk_type?: RiskType | RiskType[];
  accepted_by?: string;
  requires_followup?: boolean;
  expiring_within_days?: number; // e.g., 7 for next week
  expired?: boolean;
}

/**
 * Risk acceptance list response
 */
export interface RiskAcceptanceListResponse {
  risks: QARiskAcceptance[];
  total: number;
  active: number;
  expiring_soon: number;
}

/**
 * Risk escalation recommendation
 */
export interface RiskEscalationRecommendation {
  risk_id: string;
  should_escalate: boolean;
  reason: string;
  days_overdue: number;
  recommended_action: string;
}
