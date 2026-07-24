/**
 * H&S Training Matrix & Competency Types
 *
 * Worker training records driving the contractor compliance gate.
 * A worker is EITHER an internal staff member (staff_id) or a contractor field
 * worker (team_member_id) — never both. contractor_id is the authoritative
 * worker→contractor link used for gate aggregation (team_members' own
 * contractor_id is unpopulated in live data, so training rows carry it directly).
 */

/** Competency status derived from expiry_date — never stored (goal §4.7). */
export type CompetencyStatus = 'current' | 'expiring_soon' | 'expired';

/** Days before expiry at which a competency is flagged "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

/** Minimum contractor training score below which the gate blocks. */
export const TRAINING_GATE_MINIMUM = 70;

export interface HSTrainingType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** null = competency never expires */
  validity_months: number | null;
  is_statutory: boolean;
  requires_certificate: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface HSWorkerTraining {
  id: string;
  training_type_id: string;
  staff_id: string | null;
  team_member_id: string | null;
  contractor_id: string | null;
  worker_name: string;
  project_id: string | null;
  completed_date: string;
  expiry_date: string | null;
  certificate_url: string | null;
  certificate_number: string | null;
  issued_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A worker training row joined with its type + derived competency status. */
export interface HSWorkerTrainingView extends HSWorkerTraining {
  training_code: string;
  training_name: string;
  is_statutory: boolean;
  competency_status: CompetencyStatus;
  days_to_expiry: number | null;
}

/** Contractor training rollup used by the gate. */
export interface ContractorTrainingScore {
  contractor_id: string;
  total_certs: number;
  current_certs: number;
  expiring_certs: number;
  expired_certs: number;
  expired_statutory_certs: number;
  /** null when there is no training data at all (does not block the gate) */
  training_score: number | null;
}
