/**
 * H&S Per-Worker Medical Fitness Types
 *
 * Certificate of Fitness (COF) records — one row per worker per examination.
 * A worker is EITHER an internal staff member (staff_id) or a contractor field
 * worker (team_member_id) — never both. contractor_id is the authoritative
 * worker→contractor link used for gate aggregation, matching hs_worker_training.
 *
 * Fitness status is derived from expiry_date at read time — never stored.
 */

/**
 * Single-sourced from training.types — the "expiring soon" window is one
 * module-wide threshold, not a per-register setting. Re-exported so medical
 * consumers do not have to reach across into training types.
 */
export { EXPIRING_SOON_DAYS } from './training.types';

/**
 * Default Certificate of Fitness validity when the caller states no expiry.
 * 12 months is the standard occupational-medicine cadence in the client files.
 */
export const MEDICAL_VALIDITY_MONTHS = 12;

/**
 * The medical verdict. Mirrors the hs_worker_medicals.outcome DB CHECK
 * constraint (migration 463) — kept in sync by medicalOutcomeSync.test.ts.
 */
export type MedicalOutcome = 'fit' | 'fit_with_restriction' | 'unfit';

/** Derived from expiry_date — never stored (mirrors CompetencyStatus). */
export type MedicalStatus = 'current' | 'expiring_soon' | 'expired';

export interface MedicalOutcomeConfig {
  value: MedicalOutcome;
  label: string;
  description: string;
  /** true = this verdict alone blocks the contractor gate */
  blocks_gate: boolean;
}

export const MEDICAL_OUTCOMES: Record<MedicalOutcome, MedicalOutcomeConfig> = {
  fit: {
    value: 'fit',
    label: 'Fit',
    description: 'Fit for the full scope of duty with no restrictions',
    blocks_gate: false,
  },
  fit_with_restriction: {
    value: 'fit_with_restriction',
    label: 'Fit with Restriction',
    description: 'Fit for duty subject to the stated restrictions',
    blocks_gate: false,
  },
  unfit: {
    value: 'unfit',
    label: 'Unfit',
    description: 'Not medically fit for duty',
    blocks_gate: true,
  },
};

export interface HSWorkerMedical {
  id: string;
  staff_id: string | null;
  team_member_id: string | null;
  contractor_id: string | null;
  worker_name: string;
  project_id: string | null;
  exam_date: string;
  /** null = no stated expiry */
  expiry_date: string | null;
  outcome: MedicalOutcome;
  restrictions: string | null;
  practitioner: string | null;
  practice_number: string | null;
  certificate_number: string | null;
  certificate_url: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A medical row with its derived fitness status. */
export interface HSWorkerMedicalView extends HSWorkerMedical {
  medical_status: MedicalStatus;
  days_to_expiry: number | null;
}

/**
 * Contractor medical rollup used by the gate.
 *
 * Counted over the LATEST medical per worker, not every historical row: a
 * worker re-examined every 12 months accumulates superseded certificates, and
 * an expired 2024 certificate says nothing about a worker whose 2026 one is
 * current. `workers_with_medicals = 0` means no data — which must not block.
 */
export interface ContractorMedicalSummary {
  contractor_id: string;
  workers_with_medicals: number;
  /** current + expiring_soon + expired === workers_with_medicals (disjoint) */
  current: number;
  expiring_soon: number;
  expired: number;
  /** outcome counts — these overlap the expiry buckets above by design */
  unfit: number;
  restricted: number;
}
