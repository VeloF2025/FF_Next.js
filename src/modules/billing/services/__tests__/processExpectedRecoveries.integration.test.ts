/**
 * Live-DB integration test for the FT expected-recovery service (migration 415).
 *
 * The unit tests cover the pure decision; this gate exercises the REAL writes
 * (candidate detection, payment_status flip, dispute-candidate mark) against real
 * billing data — but inside a single BEGIN ... ROLLBACK, so NOTHING is persisted.
 * It runs the core for two consecutive real billing weeks of one project so the
 * full pending → recovered/not_returned lifecycle is driven by live data.
 *
 * Gating: skipped unless SUPABASE_INTEGRATION_TEST=true. Requires
 * SUPABASE_INTEGRATION_DB_URL. Run locally with:
 *
 *   SUPABASE_INTEGRATION_TEST=true \
 *   SUPABASE_INTEGRATION_DB_URL=postgresql://postgres:<pw>@127.0.0.1:5437/fibreflow \
 *     npx vitest run src/modules/billing/services/__tests__/processExpectedRecoveries.integration.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { processExpectedRecoveriesCore } from '../processExpectedRecoveries';
import { CANDIDATE_SQL, type CandidateRow } from '../recoveryCandidatesSql';

const INTEGRATION_ENABLED = process.env.SUPABASE_INTEGRATION_TEST === 'true';

describe.skipIf(!INTEGRATION_ENABLED)('processExpectedRecoveries (live DB, rolled back)', () => {
  let pool: Pool;

  beforeAll(() => {
    const connectionString = process.env.SUPABASE_INTEGRATION_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_INTEGRATION_DB_URL is required when SUPABASE_INTEGRATION_TEST=true');
    pool = new Pool({ connectionString, max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('candidate query parses, returns rows, and every fix POST-DATES its deduction week', async () => {
    const proj = await pool.query<{ project: string }>(
      `SELECT project FROM ft_billing_deductions GROUP BY project ORDER BY count(*) DESC LIMIT 1`,
    );
    const project = proj.rows[0]?.project;
    expect(project).toBeTruthy();

    const res = await pool.query<CandidateRow>(CANDIDATE_SQL, [project]);
    expect(res.rows.length).toBeGreaterThan(0); // the busiest project must have candidates
    for (const row of res.rows) {
      expect(['onemap_fix', 'offline_recovery', 'pp_activation']).toContain(row.fix_signal);
      expect(row.fix_at).not.toBeNull();
      expect(row.fix_at!.slice(0, 10) > row.deduction_week_ending).toBe(true); // strictly after
      // note2 must never qualify via the 1Map (onemap) signal (semantic guard).
      if (row.deduction_note === 'note2') expect(row.fix_signal).not.toBe('onemap_fix');
    }
  });

  it('drives the full lifecycle across two real billing weeks without persisting', async () => {
    const weeks = await pool.query<{ id: string; week_ending: string; project: string }>(
      `SELECT w.id, w.week_ending::text AS week_ending, w.project
         FROM ft_weekly_billing w
        WHERE w.project = (
          SELECT project FROM ft_weekly_billing GROUP BY project
          HAVING count(*) >= 2 ORDER BY count(*) DESC LIMIT 1)
        ORDER BY w.week_ending DESC LIMIT 2`,
    );
    expect(weeks.rows.length).toBe(2);
    const [later, earlier] = weeks.rows; // DESC → [0]=later, [1]=earlier
    const project = later.project;

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ft_billing_expected_recovery WHERE project = $1`, [project]);

      // 1) Detect at the earlier week → pending / immediate-recovered rows.
      const detect = await processExpectedRecoveriesCore(client, earlier.id);
      expect(detect.pendingCreated + detect.recovered).toBeGreaterThan(0); // candidates were processed
      expect(detect.notReturned).toBe(0); // nothing to confirm yet

      // Active-dispute guard (F4): mark one pending episode's later-week deduction as
      // 'disputing' and record its verdict; confirm must NOT overwrite that verdict.
      const guarded = await client.query<{ id: string; verdict: string | null }>(
        `SELECT d.id, d.verdict
           FROM ft_billing_expected_recovery r
           JOIN ft_billing_deductions d ON d.billing_week_id = $1 AND d.dr_number = r.drop_number
          WHERE r.project = $2 AND r.status = 'pending' LIMIT 1`,
        [later.id, project],
      );
      const guardedDeduction = guarded.rows[0];
      if (guardedDeduction) {
        await client.query(`UPDATE ft_billing_deductions SET resolution_status='disputing' WHERE id=$1`, [guardedDeduction.id]);
      }

      // 2) Confirm at the later week → prior pending rows resolve.
      const confirm = await processExpectedRecoveriesCore(client, later.id);
      expect(confirm.recovered + confirm.notReturned).toBeGreaterThan(0); // pending rows were judged

      // Invariant A: a 'recovered' episode must have flipped its DR off 'deducted'.
      const badRecovered = await client.query(
        `SELECT count(*)::int AS n FROM ft_billing_expected_recovery r
           JOIN oes_activations oa ON oa.drop_number = r.drop_number
          WHERE r.project = $1 AND r.status = 'recovered' AND oa.payment_status = 'deducted'`,
        [project],
      );
      expect(badRecovered.rows[0].n).toBe(0);

      // Invariant B: every 'not_returned' episode carries a dispute link + verdict.
      const badNotReturned = await client.query(
        `SELECT count(*)::int AS n FROM ft_billing_expected_recovery r
           LEFT JOIN ft_billing_deductions d ON d.id = r.dispute_deduction_id
          WHERE r.project = $1 AND r.status = 'not_returned'
            AND (r.dispute_deduction_id IS NULL OR d.verdict <> 'disputable')`,
        [project],
      );
      expect(badNotReturned.rows[0].n).toBe(0);

      // Invariant C: the recovered counter matches DB state for this run.
      expect(confirm.recovered).toBe(
        (await client.query(
          `SELECT count(*)::int AS n FROM ft_billing_expected_recovery
            WHERE project=$1 AND status='recovered' AND confirmed_billing_week_id=$2`,
          [project, later.id],
        )).rows[0].n,
      );

      // Invariant D (F4): the active-dispute deduction's verdict was NOT overwritten.
      if (guardedDeduction) {
        const after = await client.query<{ verdict: string | null }>(
          `SELECT verdict FROM ft_billing_deductions WHERE id=$1`,
          [guardedDeduction.id],
        );
        expect(after.rows[0].verdict ?? null).toBe(guardedDeduction.verdict ?? null);
      }
    } finally {
      await client.query('ROLLBACK'); // discard ALL test writes
      client.release();
    }
  });
});
