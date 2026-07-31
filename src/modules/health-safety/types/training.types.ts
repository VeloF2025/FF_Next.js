/**
 * H&S Training Matrix & Competency Types
 *
 * Worker training records driving the contractor compliance gate.
 * A worker is EITHER an internal staff member (staff_id) or a contractor field
 * worker (team_member_id) — never both. contractor_id is the authoritative
 * worker→contractor link used for gate aggregation (team_members' own
 * contractor_id is unpopulated in live data, so training rows carry it directly).
 */

/**
 * Competency status derived from expiry_date — never stored (goal §4.7).
 * `missing` is not a record state: it is used only by the per-project gap
 * matrix, where a worker has no record at all for a required training type.
 */
export type CompetencyStatus = 'current' | 'expiring_soon' | 'expired';
export type CompetencyCellStatus = CompetencyStatus | 'missing';

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

/**
 * Lifecycle of the evidence behind a competency (migration 471).
 *
 * Only `verified` counts. A pending submission has been uploaded but nobody has
 * looked at it; a rejected one was refused; a revoked one was accepted and then
 * withdrawn. The last two are kept rather than deleted because "this stopped
 * counting, and why" is the record that prevents it counting again.
 */
export type TrainingVerificationStatus = 'pending' | 'verified' | 'rejected' | 'revoked';

/** Competency chip shown against a stored certificate. Carries no file location. */
export interface LinkedTrainingTypeSummary {
  id: string;
  code: string;
  name: string;
  verificationStatus: TrainingVerificationStatus;
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
  /**
   * @deprecated Legacy free-text URL, retained for rows created before 471.
   * New records link the stored binary through `staff_document_id` and must
   * never expose this field in a response.
   */
  certificate_url: string | null;
  certificate_number: string | null;
  issued_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** The one stored certificate this competency is evidenced by. */
  staff_document_id: string | null;
  verification_status: TrainingVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

/** A worker training row joined with its type + derived competency status. */
export interface HSWorkerTrainingView extends HSWorkerTraining {
  training_code: string;
  training_name: string;
  is_statutory: boolean;
  competency_status: CompetencyStatus;
  days_to_expiry: number | null;
}

/**
 * What an H&S reader is allowed to receive.
 *
 * `certificate_url` is dropped rather than nulled so that a handler cannot
 * select it back in by accident, and no storage path or URL appears at all:
 * the binary is reachable only through the permission-checked
 * /api/staff-documents-download route. `hasCertificate` answers "is there a
 * file behind this?" without saying where it is.
 */
export interface HSWorkerTrainingSafeView extends Omit<HSWorkerTrainingView, 'certificate_url'> {
  hasCertificate: boolean;
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
