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
 * If FT later re-deducts a DR it had conceded, the recovered episode is re-opened to
 * not_returned and payment_status is flipped back to 'deducted' — so a recovery flip
 * never masks a live re-deduction. Own BEGIN/COMMIT/ROLLBACK (mirrors
 * reconcileBillingWeek) so a failure here never rolls back the persisted import; the
 * per-episode decision is the pure decideRecovery(), this file owns the SQL effects.
 */

import type { PoolClient } from 'pg';
import { log } from '@/lib/logger';
import { decideRecovery, type RecoveryStatus } from './recoveryTransition';
import { CANDIDATE_SQL, type CandidateRow } from './recoveryCandidatesSql';

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

/** Flip a confirmed-recovered DR deducted→paid (gated: only if still 'deducted'). */
async function flipToPaid(client: PoolClient, dropNumber: string, weekEnding: string): Promise<number> {
  const r = await client.query(
    `UPDATE oes_activations SET payment_status = 'paid', payment_week = $1, updated_at = NOW()
      WHERE drop_number = $2 AND payment_status = 'deducted'`,
    [weekEnding, dropNumber],
  );
  return r.rowCount ?? 0;
}

/** Re-mark a re-deducted (previously paid-by-recovery) DR back to deducted. Gated to
 *  'paid' so the normal pending→not_returned path (already 'deducted') is a no-op. */
async function reMarkDeducted(client: PoolClient, dropNumber: string, weekEnding: string, note: string): Promise<number> {
  const r = await client.query(
    `UPDATE oes_activations SET payment_status = 'deducted', payment_week = $1, payment_note = $2, updated_at = NOW()
      WHERE drop_number = $3 AND payment_status = 'paid'`,
    [weekEnding, note, dropNumber],
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

  // "Still deducted" is DR-level on purpose: if FT bills the DR for ANY note this
  // week, it did not return to the paid pool, so the episode is not recovered even if
  // this week's note differs from the episode's note.
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

  const out: ExpectedRecoveryOutcome = {
    billingWeekId, project, weekEnding,
    pendingCreated: 0, recovered: 0, notReturned: 0, paymentFlipped: 0, disputeCandidates: 0,
  };

  // Process every episode that is a candidate now OR has a prior row, so both
  // detection and confirmation (incl. re-deduction of recovered DRs) are covered.
  const keys = new Set<string>([...candByKey.keys(), ...existingByKey.keys()]);
  for (const key of keys) {
    const cand = candByKey.get(key);
    const existing = existingByKey.get(key);
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

    const evidence = cand ? { fix_signal: cand.fix_signal, fix_at: cand.fix_at, deduction_note: note } : null;

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
      const r = await client.query(
        `UPDATE ft_billing_expected_recovery
            SET status='recovered', confirmed_week_ending=$1::date, confirmed_billing_week_id=$2,
                recovery_lag_days=($1::date - deduction_week_ending), updated_at=NOW()
          WHERE project=$3 AND drop_number=$4 AND deduction_note=$5 AND deduction_week_ending=$6::date
            AND status='pending'`,
        [weekEnding, billingWeekId, project, dropNumber, note, dedWeek],
      );
      if ((r.rowCount ?? 0) > 0) {
        out.recovered += 1;
        out.paymentFlipped += await flipToPaid(client, dropNumber, weekEnding);
      }
    } else if (action === 'mark_not_returned') {
      // Find this week's deduction for the DR (prefer the episode's note, else any).
      const dedRes = await client.query<{ id: string }>(
        `SELECT id FROM ft_billing_deductions
          WHERE billing_week_id=$1 AND dr_number=$2
          ORDER BY (deduction_note = $3) DESC, created_at DESC
          LIMIT 1`,
        [billingWeekId, dropNumber, note],
      );
      const deductionId = dedRes.rows[0]?.id ?? null;
      const upd = await client.query(
        `UPDATE ft_billing_expected_recovery
            SET status='not_returned', confirmed_week_ending=$1::date, confirmed_billing_week_id=$2,
                dispute_deduction_id=$3, updated_at=NOW()
          WHERE project=$4 AND drop_number=$5 AND deduction_note=$6 AND deduction_week_ending=$7::date
            AND status IN ('pending','recovered')`,
        [weekEnding, billingWeekId, deductionId, project, dropNumber, note, dedWeek],
      );
      if ((upd.rowCount ?? 0) === 0) continue;
      out.notReturned += 1;
      // If this DR had been flipped to 'paid' by a prior recovery, FT just re-deducted
      // it — put it back to 'deducted' so the books stay honest.
      out.paymentFlipped -= await reMarkDeducted(client, dropNumber, weekEnding, note);
      if (deductionId) {
        // Mark a dispute candidate (verdict='disputable') so it surfaces in the existing
        // Action Centre Candidates flow. Guard: never disturb an active dispute lifecycle.
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
      } else {
        log.warn('expected-recovery: not_returned episode has no deduction row this week', {
          project, dropNumber, note, weekEnding,
        });
      }
    }
  }

  return out;
}
