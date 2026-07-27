/**
 * H&S Medical Fitness Service
 *
 * Rolls a contractor's per-worker Certificate of Fitness records up into the
 * summary the compliance gate consumes. All fitness logic is evaluated in SQL
 * against expiry_date — nothing is stored pre-computed.
 *
 * Unlike the training rollup, this counts the LATEST medical per worker rather
 * than every historical row: workers are re-examined annually, so superseded
 * certificates accumulate, and an expired 2024 certificate says nothing about a
 * worker whose current one is valid.
 */

import { neon } from '@neondatabase/serverless';
import {
  EXPIRING_SOON_DAYS,
  type ContractorMedicalSummary,
} from '../types/medical.types';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Summarise a contractor's medical fitness position.
 *
 * `workers_with_medicals = 0` means there is no medical data on file at all —
 * which must NOT block the gate, matching the pre-existing "absence of data is
 * not evidence of non-compliance" semantics used by the training score.
 */
export async function computeContractorMedicalSummary(
  contractorId: string
): Promise<ContractorMedicalSummary> {
  const [row] = await sql`
    WITH latest AS (
      SELECT DISTINCT ON (COALESCE(m.staff_id, m.team_member_id))
        m.outcome,
        m.expiry_date
      FROM hs_worker_medicals m
      WHERE m.contractor_id = ${contractorId}
      ORDER BY COALESCE(m.staff_id, m.team_member_id), m.exam_date DESC, m.created_at DESC
    )
    SELECT
      COUNT(*)::int AS workers_with_medicals,
      COUNT(*) FILTER (
        WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE
      )::int AS current,
      COUNT(*) FILTER (
        WHERE expiry_date IS NOT NULL
          AND expiry_date >= CURRENT_DATE
          AND expiry_date <= CURRENT_DATE + make_interval(days => ${EXPIRING_SOON_DAYS})
      )::int AS expiring_soon,
      COUNT(*) FILTER (
        WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE
      )::int AS expired,
      COUNT(*) FILTER (WHERE outcome = 'unfit')::int AS unfit,
      COUNT(*) FILTER (WHERE outcome = 'fit_with_restriction')::int AS restricted
    FROM latest
  `;

  return {
    contractor_id: contractorId,
    workers_with_medicals: Number(row?.workers_with_medicals ?? 0),
    current: Number(row?.current ?? 0),
    expiring_soon: Number(row?.expiring_soon ?? 0),
    expired: Number(row?.expired ?? 0),
    unfit: Number(row?.unfit ?? 0),
    restricted: Number(row?.restricted ?? 0),
  };
}
