/**
 * Ticketing Module - Handover & Ownership Transfer Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for handover snapshots, ownership transfers,
 * and immutable audit trails.
 */

import { GuaranteeStatus } from './ticket';

/**
 * Handover Type - Type of ownership transfer
 */
export enum HandoverType {
  BUILD_TO_QA = 'build_to_qa',
  QA_TO_MAINTENANCE = 'qa_to_maintenance',
  MAINTENANCE_COMPLETE = 'maintenance_complete',
}

/**
 * Owner Type - Entity type owning the ticket at handover
 */
export enum OwnerType {
  BUILD = 'build',
  QA = 'qa',
  MAINTENANCE = 'maintenance',
}

/**
 * Handover Snapshot Interface
 * Immutable record of ticket state at handover
 */
export interface HandoverSnapshot {
  // Primary identification
  id: string; // UUID
  ticket_id: string; // UUID reference to tickets

  // Handover type
  handover_type: HandoverType;

  // Snapshot data (JSONB - immutable record of state)
  snapshot_data: HandoverSnapshotData;
  evidence_links: EvidenceLink[] | null; // All photo/document URLs
  decisions: HandoverDecision[] | null; // All approval/rejection records
  guarantee_status: GuaranteeStatus | null;

  // Ownership change
  from_owner_type: OwnerType | null;
  from_owner_id: string | null; // UUID
  to_owner_type: OwnerType | null;
  to_owner_id: string | null; // UUID

  // Audit
  handover_at: Date;
  handover_by: string; // UUID reference to users (NOT NULL)

  // Lock status
  is_locked: boolean;

  // Timestamp
  created_at: Date;
}

/**
 * Handover snapshot data structure
 * Complete ticket state at time of handover
 */
export interface HandoverSnapshotData {
  // Ticket core data
  ticket_uid: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  ticket_type: string;

  // Location data
  dr_number: string | null;
  project_id: string | null;
  zone_id: string | null;
  pole_number: string | null;
  pon_number: string | null;
  address: string | null;

  // Equipment data
  ont_serial: string | null;
  ont_rx_level: number | null;
  ont_model: string | null;

  // Assignment data
  assigned_to: string | null;
  assigned_contractor_id: string | null;
  assigned_team: string | null;

  // QA readiness
  qa_ready: boolean;
  qa_readiness_check_at: Date | null;

  // Fault attribution
  fault_cause: string | null;
  fault_cause_details: string | null;

  // Verification progress
  verification_steps_completed: number;
  verification_steps_total: number;

  // Metadata
  snapshot_timestamp: Date;
}

/**
 * Evidence link reference
 */
export interface EvidenceLink {
  type: 'photo' | 'document';
  step_number: number | null;
  url: string;
  filename: string;
  uploaded_at: Date;
  uploaded_by: string | null;
}

/**
 * Handover decision record
 */
export interface HandoverDecision {
  decision_type: 'approval' | 'rejection' | 'risk_acceptance' | 'escalation';
  decision_by: string; // User ID
  decision_at: Date;
  notes: string | null;
  metadata: Record<string, any> | null;
}

/**
 * Create handover snapshot payload
 */
export interface CreateHandoverSnapshotPayload {
  ticket_id: string;
  handover_type: HandoverType;
  from_owner_type?: OwnerType;
  from_owner_id?: string;
  to_owner_type?: OwnerType;
  to_owner_id?: string;
  handover_by: string; // User ID
}

/**
 * Handover gate validation result
 */
export interface HandoverGateValidation {
  can_handover: boolean;
  blocking_issues: HandoverBlocker[];
  warnings: string[];
  gates_passed: HandoverGateCheck[];
  gates_failed: HandoverGateCheck[];
}

/**
 * Handover gate check
 */
export interface HandoverGateCheck {
  gate_name: string;
  passed: boolean;
  required: boolean;
  message: string;
}

/**
 * Handover blocker
 */
export interface HandoverBlocker {
  gate_name: string;
  severity: 'critical' | 'high' | 'medium';
  message: string;
  resolution_hint: string;
}

/**
 * Handover gate names (for maintenance handover)
 */
export enum HandoverGateName {
  AS_BUILT_CONFIRMED = 'as_built_confirmed',
  PHOTOS_ARCHIVED = 'photos_archived',
  ONT_PON_VERIFIED = 'ont_pon_verified',
  CONTRACTOR_ASSIGNED = 'contractor_assigned',
  QA_APPROVED = 'qa_approved',
  NO_ACTIVE_RISKS = 'no_active_risks',
  VERIFICATION_COMPLETE = 'verification_complete',
}

/**
 * Handover history for a ticket
 */
export interface TicketHandoverHistory {
  ticket_id: string;
  ticket_uid: string;
  handovers: HandoverSnapshot[];
  total_handovers: number;
  current_owner_type: OwnerType | null;
  current_owner_id: string | null;
}

/**
 * Handover statistics
 */
export interface HandoverStats {
  total_handovers: number;
  by_type: Record<HandoverType, number>;
  avg_time_to_handover_hours: number;
  pending_handovers: number;
}
