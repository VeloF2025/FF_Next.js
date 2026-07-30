/**
 * H&S Training Service
 *
 * Computes worker competency (current / expiring_soon / expired) and the
 * per-contractor training score that feeds the compliance gate. All competency
 * logic is evaluated in SQL against expiry_date (goal §4.7) — nothing is stored
 * pre-computed except the rolled-up training_score, which is persisted onto
 * hs_contractor_compliance so the dashboard and gate read a consistent value.
 */

import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import {
  EXPIRING_SOON_DAYS,
  type ContractorTrainingScore,
} from '../types/training.types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Competency-status derivation (goal §4.7) is written inline in each listing
 * query rather than shared as a string: the Neon shim binds template
 * interpolations as parameters, so a raw SQL fragment cannot be injected. The
 * threshold itself stays single-sourced as the bound `EXPIRING_SOON_DAYS`
 * number wherever the expression appears.
 */

/**
 * Roll up a contractor's worker training into a single score.
 *
 * Only `verified` rows are considered (migration 471). A pending submission has
 * been uploaded but nobody has checked it, a rejected one was refused, and a
 * revoked one was withdrawn — none of them is evidence, so none may raise a
 * gate score. They are excluded in the WHERE rather than counted and subtracted,
 * so an unverified population reads as "no data" (score null, does not block)
 * rather than as a 0% failure.
 *
 * score = current_certs / total_certs * 100, rounded. Here "current" is the
 * gate's broad sense — any cert not yet expired, which INCLUDES the
 * expiring-soon bucket (that is a warning, not a failure). This is deliberately
 * wider than the per-record `current` status used in the listing/gap views,
 * which excludes expiring_soon. total_certs = 0 → score null (no data — must
 * NOT block the gate, matching the pre-existing NULL semantics).
 */
export async function computeContractorTrainingScore(
  contractorId: string
): Promise<ContractorTrainingScore> {
  const [row] = await sql`
    SELECT
      COUNT(*)::int AS total_certs,
      COUNT(*) FILTER (
        WHERE wt.expiry_date IS NULL OR wt.expiry_date >= CURRENT_DATE
      )::int AS current_certs,
      COUNT(*) FILTER (
        WHERE wt.expiry_date IS NOT NULL
          AND wt.expiry_date >= CURRENT_DATE
          AND wt.expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS})
      )::int AS expiring_certs,
      COUNT(*) FILTER (
        WHERE wt.expiry_date IS NOT NULL AND wt.expiry_date < CURRENT_DATE
      )::int AS expired_certs,
      COUNT(*) FILTER (
        WHERE wt.expiry_date IS NOT NULL AND wt.expiry_date < CURRENT_DATE
          AND tt.is_statutory
      )::int AS expired_statutory_certs
    FROM hs_worker_training wt
    JOIN hs_training_types tt ON tt.id = wt.training_type_id
    WHERE wt.contractor_id = ${contractorId}
      AND wt.verification_status = 'verified'
  `;

  const total = Number(row?.total_certs ?? 0);
  const current = Number(row?.current_certs ?? 0);
  const trainingScore = total === 0 ? null : Math.round((current / total) * 100);

  return {
    contractor_id: contractorId,
    total_certs: total,
    current_certs: current,
    expiring_certs: Number(row?.expiring_certs ?? 0),
    expired_certs: Number(row?.expired_certs ?? 0),
    expired_statutory_certs: Number(row?.expired_statutory_certs ?? 0),
    training_score: trainingScore,
  };
}

/**
 * Compute the score and persist it onto the contractor's compliance row so the
 * dashboard reflects it. Persistence is best-effort — a write failure must not
 * break the gate check, which uses the returned value directly. Assumes the
 * compliance row already exists (the gate creates it before calling this).
 */
export async function computeAndPersistContractorTrainingScore(
  contractorId: string
): Promise<ContractorTrainingScore> {
  const score = await computeContractorTrainingScore(contractorId);

  try {
    await sql`
      UPDATE hs_contractor_compliance
      SET training_score = ${score.training_score}, updated_at = NOW()
      WHERE contractor_id = ${contractorId}
    `;
  } catch (error) {
    log.warn('[H&S] persisting contractor training_score failed (non-fatal)', {
      error,
      contractorId,
    });
  }

  return score;
}
