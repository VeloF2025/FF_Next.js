/**
 * Process FT expected-recoveries for one billing week (audit rec #2).
 *
 * Called from the weekly bundle import AFTER reconcileBillingWeek has tagged this
 * week's deductions. For the bundle's project + week it:
 *   1. detects "fixed-but-deducted" episodes (note-aware + temporal candidate query),
 *   2. confirms prior pending episodes against THIS week's deduction list,
 *   3. writes the audit row, flips oes_activations.payment_status deducted→paid on
 *      confirmed recoveries, and marks not_returned deductions as dispute candidates.
 *
 * Own BEGIN/COMMIT/ROLLBACK (mirrors reconcileBillingWeek) so a failure here never
 * rolls back the already-persisted import. The decision per episode is the pure
 * decideRecovery(); this file owns only the SQL side-effects.
 */

import type { PoolClient } from 'pg';
import { decideRecovery, type RecoveryStatus } from './recoveryTransition';

export interface ExpectedRecoveryOutcome {
  billingWeekId: string;
  project: string;
  weekEnding: string;
  pendingCreated: number;
  recovered: number;
  notReturned: number;
  paymentFlipped: number;
  disputeCandidates: number;
}

interface CandidateRow {
  drop_number: string;
  deduction_note: string;
  deduction_week_ending: string;
  fix_signal: string;
  fix_at: string | null;
}

interface ExistingRow {
  drop_number: string;
  deduction_note: string;
  deduction_week_ending: string;
  status: RecoveryStatus;
  detected_week_ending: string;
  fix_signal: string;
  fix_at: string | null;
}

const episodeKey = (dropNumber: string, note: string, dedWeek: string) =>
  `${dropNumber}|${note}|${dedWeek}`;

// Note-aware + temporal candidates, anchored on ft_billing_deductions.project (FT's
// own label — robust to project-name variants) and the latest deduction per DR that
// is still tagged deducted. The 1Map fix timestamp is read from the rec #3 ledger
// (joined by drop_number); offline / PP signals come from their own tables. A fix
// only qualifies if it POST-DATES the deduction week (verified live: 438 DRs; a
// naive "ever fixed" filter matched 97% and is useless).
export const CANDIDATE_SQL = `
  WITH latest_ded AS (
    SELECT DISTINCT ON (dr_number) dr_number, deduction_note, week_ending
    FROM ft_billing_deductions
    WHERE project = $1 AND dr_number IS NOT NULL
    ORDER BY dr_number, week_ending DESC
  )
  SELECT
    ld.dr_number AS drop_number,
    ld.deduction_note,
    ld.week_ending::text AS deduction_week_ending,
    CASE
      WHEN ld.deduction_note IN ('note2','note4') AND l.onemap_mismatch_resolved_at::date > ld.week_ending THEN 'onemap_fix'
      WHEN ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL THEN 'offline_recovery'
      WHEN ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL THEN 'pp_activation'
    END AS fix_signal,
    CASE
      WHEN ld.deduction_note IN ('note2','note4') AND l.onemap_mismatch_resolved_at::date > ld.week_ending THEN l.onemap_mismatch_resolved_at::text
      WHEN ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL THEN ofr.recovered_at::text
      WHEN ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL THEN ppr.activated_at::text
    END AS fix_at
  FROM latest_ded ld
  JOIN oes_activations oa ON oa.drop_number = ld.dr_number AND oa.payment_status = 'deducted'
  LEFT JOIN v_dr_reconciliation_ledger l ON l.drop_number = ld.dr_number
  LEFT JOIN LATERAL (
    SELECT max(od.recovered_at) AS recovered_at FROM offline_devices od
    WHERE od.drop_number = ld.dr_number AND od.recovered_at > ld.week_ending
  ) ofr ON true
  LEFT JOIN LATERAL (
    SELECT max(pp.activated_at) AS activated_at FROM oes_pp_data pp
    WHERE pp.resolved_drop_number = ld.dr_number AND pp.activated_at::date > ld.week_ending
  ) ppr ON true
  WHERE (ld.deduction_note IN ('note2','note4') AND l.onemap_mismatch_resolved_at::date > ld.week_ending)
     OR (ld.deduction_note = 'note5' AND ofr.recovered_at IS NOT NULL)
     OR (ld.deduction_note = 'note2' AND ppr.activated_at IS NOT NULL)`;

/** Flip a confirmed-recovered DR deducted→paid (gated: only if still 'deducted'). */
async function flipToPaid(client: PoolClient, dropNumber: string, weekEnding: string): Promise<number> {
  const r = await client.query(
    `UPDATE oes_activations SET payment_status = 'paid', payment_week = $1, updated_at = NOW()
      WHERE drop_number = $2 AND payment_status = 'deducted'`,
    [weekEnding, dropNumber],
  );
  return r.rowCount ?? 0;
}

export async function processExpectedRecoveries(
  client: PoolClient,
  billingWeekId: string,
): Promise<ExpectedRecoveryOutcome> {
  await client.query('BEGIN');
  try {
    const out = await processExpectedRecoveriesCore(client, billingWeekId);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * The write logic without transaction control — assumes the caller already opened a
 * transaction. Exposed so tests can run it inside BEGIN ... ROLLBACK, exercising the
 * real writes against real data without persisting anything.
 */
export async function processExpectedRecoveriesCore(
  client: PoolClient,
  billingWeekId: string,
): Promise<ExpectedRecoveryOutcome> {
    const weekRes = await client.query<{ project: string; week_ending: string }>(
      `SELECT project, week_ending::text AS week_ending FROM ft_weekly_billing WHERE id = $1`,
      [billingWeekId],
    );
    const week = weekRes.rows[0];
    if (!week) throw new Error(`Billing week ${billingWeekId} not found`);
    const { project, week_ending: weekEnding } = week;

    const dnRes = await client.query<{ dr_number: string }>(
      `SELECT dr_number FROM ft_billing_deductions WHERE billing_week_id = $1`,
      [billingWeekId],
    );
    const deductedThisWeek = new Set(dnRes.rows.map((r) => r.dr_number));

    const candRes = await client.query<CandidateRow>(CANDIDATE_SQL, [project]);
    const candByKey = new Map<string, CandidateRow>();
    for (const c of candRes.rows) {
      candByKey.set(episodeKey(c.drop_number, c.deduction_note, c.deduction_week_ending), c);
    }

    const existingRes = await client.query<ExistingRow>(
      `SELECT drop_number, deduction_note, deduction_week_ending::text AS deduction_week_ending,
              status, detected_week_ending::text AS detected_week_ending,
              fix_signal, fix_at::text AS fix_at
         FROM ft_billing_expected_recovery WHERE project = $1`,
      [project],
    );
    const existingByKey = new Map<string, ExistingRow>();
    for (const e of existingRes.rows) {
      existingByKey.set(episodeKey(e.drop_number, e.deduction_note, e.deduction_week_ending), e);
    }

    // Process every episode that is a candidate now OR has a prior pending row, so
    // both detection and confirmation are covered without double-handling a key.
    const keys = new Set<string>([...candByKey.keys(), ...existingByKey.keys()]);
    const out: ExpectedRecoveryOutcome = {
      billingWeekId, project, weekEnding,
      pendingCreated: 0, recovered: 0, notReturned: 0, paymentFlipped: 0, disputeCandidates: 0,
    };

    for (const key of keys) {
      const cand = candByKey.get(key);
      const existing = existingByKey.get(key);
      // Skip prior pending rows that are no longer detectable as a fixed episode AND
      // are not in this week's deductions — nothing to confirm against.
      if (!cand && !existing) continue;
      const dropNumber = (cand ?? existing)!.drop_number;
      const note = (cand ?? existing)!.deduction_note;
      const dedWeek = (cand ?? existing)!.deduction_week_ending;
      const stillDeducted = deductedThisWeek.has(dropNumber);

      const action = decideRecovery({
        existing: existing ? { status: existing.status, detectedWeekEnding: existing.detected_week_ending } : null,
        stillDeductedThisWeek: stillDeducted,
        currentWeekEnding: weekEnding,
      });

      if (action === 'noop') continue;
      const evidence = cand
        ? { fix_signal: cand.fix_signal, fix_at: cand.fix_at, deduction_note: note }
        : null;

      if (action === 'insert_pending' && cand) {
        const r = await client.query(
          `INSERT INTO ft_billing_expected_recovery
             (drop_number, project, deduction_note, deduction_week_ending, fix_signal, fix_at,
              status, detected_week_ending, detected_billing_week_id, evidence)
           VALUES ($1,$2,$3,$4::date,$5,$6::timestamptz,'pending',$7::date,$8,$9::jsonb)
           ON CONFLICT ON CONSTRAINT ft_ber_episode_uniq DO NOTHING`,
          [dropNumber, project, note, dedWeek, cand.fix_signal, cand.fix_at, weekEnding, billingWeekId, JSON.stringify(evidence)],
        );
        out.pendingCreated += r.rowCount ?? 0;
      } else if (action === 'insert_recovered' && cand) {
        const r = await client.query(
          `INSERT INTO ft_billing_expected_recovery
             (drop_number, project, deduction_note, deduction_week_ending, fix_signal, fix_at,
              status, detected_week_ending, detected_billing_week_id,
              confirmed_week_ending, confirmed_billing_week_id, recovery_lag_days, evidence)
           VALUES ($1,$2,$3,$4::date,$5,$6::timestamptz,'recovered',$7::date,$8,
              $7::date,$8,($7::date - $4::date),$9::jsonb)
           ON CONFLICT ON CONSTRAINT ft_ber_episode_uniq DO NOTHING`,
          [dropNumber, project, note, dedWeek, cand.fix_signal, cand.fix_at, weekEnding, billingWeekId, JSON.stringify(evidence)],
        );
        if ((r.rowCount ?? 0) > 0) {
          out.recovered += 1;
          out.paymentFlipped += await flipToPaid(client, dropNumber, weekEnding);
        }
      } else if (action === 'mark_recovered') {
        await client.query(
          `UPDATE ft_billing_expected_recovery
              SET status='recovered', confirmed_week_ending=$1::date, confirmed_billing_week_id=$2,
                  recovery_lag_days=($1::date - deduction_week_ending), updated_at=NOW()
            WHERE drop_number=$3 AND deduction_note=$4 AND deduction_week_ending=$5::date`,
          [weekEnding, billingWeekId, dropNumber, note, dedWeek],
        );
        out.recovered += 1;
        out.paymentFlipped += await flipToPaid(client, dropNumber, weekEnding);
      } else if (action === 'mark_not_returned') {
        const dedRes = await client.query<{ id: string }>(
          `SELECT id FROM ft_billing_deductions
            WHERE billing_week_id=$1 AND dr_number=$2 AND deduction_note=$3 LIMIT 1`,
          [billingWeekId, dropNumber, note],
        );
        const deductionId = dedRes.rows[0]?.id ?? null;
        await client.query(
          `UPDATE ft_billing_expected_recovery
              SET status='not_returned', confirmed_week_ending=$1::date, confirmed_billing_week_id=$2,
                  dispute_deduction_id=$3, updated_at=NOW()
            WHERE drop_number=$4 AND deduction_note=$5 AND deduction_week_ending=$6::date`,
          [weekEnding, billingWeekId, deductionId, dropNumber, note, dedWeek],
        );
        out.notReturned += 1;
        if (deductionId) {
          // Mark a dispute candidate (verdict='disputable') so it surfaces in the
          // existing Action Centre Candidates flow. Guard: never disturb a deduction
          // already in an active dispute lifecycle.
          const dr = await client.query(
            `UPDATE ft_billing_deductions
                SET verdict='disputable',
                    verdict_evidence=jsonb_build_object(
                      'source','expected_recovery','recovery_status','not_returned',
                      'deduction_note',$2::text,'fix_signal',$3::text,'fix_at',$4::text,'expected_since',$5::text,
                      'reasons',jsonb_build_array('cause fixed but FT still deducting after a billing cycle')),
                    verdict_computed_at=NOW()
              WHERE id=$1
                AND COALESCE(resolution_status,'open') NOT IN ('disputing','disputed','acknowledged','resolved')`,
            [deductionId, note, existing?.fix_signal ?? null, existing?.fix_at ?? null, existing?.detected_week_ending ?? weekEnding],
          );
          out.disputeCandidates += dr.rowCount ?? 0;
        }
      }
    }

    return out;
}
