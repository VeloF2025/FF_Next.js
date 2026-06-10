/**
 * Deduction verdict service — the FT deduction auto-verifier.
 *
 * For every deduction row of a billing week, loads our own evidence
 * (latest OES status/RX, DR submission record, 1Map fix history, OLT
 * mismatch state, offline-device evidence) and persists a verdict via
 * classifyDeductionVerdict. Disputable rows surface as candidates in the
 * Action Centre Disputes workflow; raising the actual dispute stays a
 * human action.
 *
 * Runs automatically after each weekly bundle import (best-effort) and
 * on demand via POST /api/billing/verify-deductions.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import {
  classifyDeductionVerdict,
  selectSignalDbm,
  type DeductionEvidence,
  type DeductionVerdict,
} from './classifyDeductionVerdict';

const logger = createLogger('DeductionVerdictService');

export interface VerdictRunSummary {
  billingWeekId: string;
  total: number;
  judged: number;
  disputable: number;
  legitimate: number;
  insufficientEvidence: number;
  /** note3 / unknown notes — never judged. */
  skipped: number;
}

interface EvidenceRow {
  id: string;
  deduction_note: string;
  oes_status: string | null;
  oes_serial: string | null;
  oes_activated_at: string | null;
  ont_rx_sig_dbm: string | number | null;
  current_ont_rx: string | number | null;
  has_dr_record: boolean;
  wa_received_at: string | null;
  last_fix_serial: string | null;
  last_fix_at: string | null;
  olt_fix_status: string | null;
  offline_id: string | null;
  offline_reason: string | null;
  offline_recovered_at: string | null;
}

// One row per deduction. DISTINCT ON guards against fan-out where a DR has
// multiple OES imports / mismatch records / offline reports.
const EVIDENCE_SQL = `
WITH week AS (
  SELECT id, week_ending FROM ft_weekly_billing WHERE id = $1
),
deductions AS (
  SELECT d.id, d.dr_number, d.deduction_note
    FROM ft_billing_deductions d, week w
   WHERE d.billing_week_id = w.id
),
latest_oes AS (
  SELECT DISTINCT ON (drop_number)
         drop_number, status, serial_number, activation_date,
         ont_rx_sig_dbm, current_ont_rx
    FROM oes_activations
   WHERE drop_number IN (SELECT dr_number FROM deductions)
   ORDER BY drop_number, COALESCE(activation_datetime, created_at) DESC
),
last_fix AS (
  SELECT DISTINCT ON (drop_number)
         drop_number, new_value AS last_fix_serial, created_at AS last_fix_at
    FROM serial_change_history
   WHERE change_source = 'olt_report_fix' AND change_type = 'ont_serial'
     AND drop_number IN (SELECT dr_number FROM deductions)
   ORDER BY drop_number, created_at DESC
),
latest_olt AS (
  SELECT DISTINCT ON (drop_number) drop_number, fix_status
    FROM olt_mismatch_records
   WHERE drop_number IN (SELECT dr_number FROM deductions)
   ORDER BY drop_number, created_at DESC
),
latest_offline AS (
  SELECT DISTINCT ON (od.drop_number)
         od.drop_number, od.id, od.last_down_reason AS reason, od.recovered_at
    FROM offline_devices od, week w
   WHERE od.drop_number IN (SELECT dr_number FROM deductions)
     AND od.report_date BETWEEN w.week_ending::date - 14 AND w.week_ending::date
   ORDER BY od.drop_number, od.report_date DESC
)
SELECT dd.id, dd.deduction_note,
       o.status              AS oes_status,
       o.serial_number       AS oes_serial,
       o.activation_date::text AS oes_activated_at,
       o.ont_rx_sig_dbm, o.current_ont_rx,
       -- A bare dr_photo_unified_reviews row is NOT proof of a field
       -- submission: the OES sync creates OES-only rows. Require an actual
       -- WA receipt or submitted date.
       (dr.id IS NOT NULL AND (dr.wa_received_at IS NOT NULL OR dr.submitted_date IS NOT NULL))
                             AS has_dr_record,
       COALESCE(dr.wa_received_at, dr.submitted_date)::text AS wa_received_at,
       f.last_fix_serial, f.last_fix_at::text,
       olt.fix_status        AS olt_fix_status,
       ofl.id                AS offline_id,
       ofl.reason            AS offline_reason,
       ofl.recovered_at::text AS offline_recovered_at
  FROM deductions dd
  LEFT JOIN latest_oes o      ON o.drop_number  = dd.dr_number
  LEFT JOIN last_fix f        ON f.drop_number  = dd.dr_number
  LEFT JOIN latest_olt olt    ON olt.drop_number = dd.dr_number
  LEFT JOIN latest_offline ofl ON ofl.drop_number = dd.dr_number
  LEFT JOIN dr_photo_unified_reviews dr ON dr.drop_number = dd.dr_number`;

function toNumber(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildEvidence(r: EvidenceRow): DeductionEvidence {
  const signalDbm = selectSignalDbm(
    r.oes_status,
    toNumber(r.ont_rx_sig_dbm),
    toNumber(r.current_ont_rx),
  );

  return {
    noteCode: r.deduction_note,
    oesStatus: r.oes_status,
    oesSerial: r.oes_serial,
    oesActivatedAt: r.oes_activated_at,
    signalDbm,
    hasDrRecord: r.has_dr_record,
    waReceivedAt: r.wa_received_at,
    lastFixSerial: r.last_fix_serial,
    lastFixAt: r.last_fix_at,
    oltFixStatus: r.olt_fix_status,
    offlineConfirmed: r.offline_id !== null,
    offlineReason: r.offline_reason,
    offlineRecoveredAt: r.offline_recovered_at,
  };
}

/**
 * Compute and persist verdicts for every deduction of a billing week.
 * Re-runs overwrite prior verdicts (evidence may have improved since).
 */
export async function computeVerdictsForWeek(
  billingWeekId: string,
): Promise<VerdictRunSummary> {
  const { rows } = await pool.query<EvidenceRow>(EVIDENCE_SQL, [billingWeekId]);

  const summary: VerdictRunSummary = {
    billingWeekId,
    total: rows.length,
    judged: 0,
    disputable: 0,
    legitimate: 0,
    insufficientEvidence: 0,
    skipped: 0,
  };

  const ids: string[] = [];
  const verdicts: DeductionVerdict[] = [];
  const evidenceJsons: string[] = [];

  for (const row of rows) {
    const evidence = buildEvidence(row);
    const result = classifyDeductionVerdict(evidence);

    if (result.verdict === null) {
      summary.skipped++;
      continue;
    }

    summary.judged++;
    if (result.verdict === 'disputable') summary.disputable++;
    else if (result.verdict === 'legitimate') summary.legitimate++;
    else summary.insufficientEvidence++;

    ids.push(row.id);
    verdicts.push(result.verdict);
    evidenceJsons.push(JSON.stringify({ ...evidence, reasons: result.reasons }));
  }

  if (ids.length > 0) {
    await pool.query(
      `UPDATE ft_billing_deductions d
          SET verdict             = v.verdict,
              verdict_evidence    = v.evidence::jsonb,
              verdict_computed_at = NOW()
         FROM UNNEST($1::uuid[], $2::text[], $3::text[]) AS v(id, verdict, evidence)
        WHERE d.id = v.id`,
      [ids, verdicts, evidenceJsons],
    );
  }

  logger.info('verdicts computed', { ...summary });
  return summary;
}
