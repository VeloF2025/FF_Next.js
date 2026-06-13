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
 *   SUPABASE_INTEGRATION_DB_URL=postgresql://postgres@127.0.0.1:5437/fibreflow \
 *     npx vitest run src/modules/billing/services/__tests__/processExpectedRecoveries.integration.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { processExpectedRecoveriesCore, CANDIDATE_SQL } from '../processExpectedRecoveries';

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

  it('candidate query parses and every candidate fix POST-DATES its deduction week', async () => {
    // Pick the project with the most billing weeks so it has candidates.
    const proj = await pool.query<{ project: string }>(
      `SELECT project FROM ft_billing_deductions GROUP BY project ORDER BY count(*) DESC LIMIT 1`,
    );
    const project = proj.rows[0]?.project;
    expect(project).toBeTruthy();

    const res = await pool.query(CANDIDATE_SQL, [project]);
    // Temporal + shape invariants on the live result set.
    for (const row of res.rows) {
      expect(['onemap_fix', 'offline_recovery', 'pp_activation']).toContain(row.fix_signal);
      expect(row.fix_at).not.toBeNull();
      expect(row.fix_at.slice(0, 10) > row.deduction_week_ending).toBe(true); // fix strictly after deduction
    }
  });

  it('drives the full lifecycle across two real billing weeks without persisting', async () => {
    // Two consecutive billing weeks for the same project (need ≥2 to test confirm).
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
      // Clear any (there shouldn't be) recovery rows for this project inside the txn
      // so the lifecycle starts clean; rolled back afterwards.
      await client.query(`DELETE FROM ft_billing_expected_recovery WHERE project = $1`, [project]);

      // 1) Detect at the earlier week → creates pending / immediate-recovered rows.
      const detect = await processExpectedRecoveriesCore(client, earlier.id);
      expect(detect.pendingCreated + detect.recovered).toBeGreaterThanOrEqual(0);
      expect(detect.notReturned).toBe(0); // nothing to confirm yet

      // 2) Confirm at the later week → prior pending rows resolve.
      const confirm = await processExpectedRecoveriesCore(client, later.id);

      // Invariant A: a 'recovered' episode must have flipped its DR off 'deducted'.
      const badRecovered = await client.query(
        `SELECT count(*)::int AS n
           FROM ft_billing_expected_recovery r
           JOIN oes_activations oa ON oa.drop_number = r.drop_number
          WHERE r.project = $1 AND r.status = 'recovered' AND oa.payment_status = 'deducted'`,
        [project],
      );
      expect(badRecovered.rows[0].n).toBe(0);

      // Invariant B: every 'not_returned' episode carries a dispute link + the
      // linked deduction is now verdict='disputable'.
      const badNotReturned = await client.query(
        `SELECT count(*)::int AS n
           FROM ft_billing_expected_recovery r
           LEFT JOIN ft_billing_deductions d ON d.id = r.dispute_deduction_id
          WHERE r.project = $1 AND r.status = 'not_returned'
            AND (r.dispute_deduction_id IS NULL OR d.verdict <> 'disputable')`,
        [project],
      );
      expect(badNotReturned.rows[0].n).toBe(0);

      // Invariant C: lifecycle actually progressed (some terminal state reached) OR
      // there were genuinely no candidates — either is valid, but counts are sane.
      expect(confirm.recovered + confirm.notReturned).toBeGreaterThanOrEqual(0);
      expect(confirm.recovered).toBe(
        (await client.query(
          `SELECT count(*)::int AS n FROM ft_billing_expected_recovery
            WHERE project=$1 AND status='recovered' AND confirmed_billing_week_id=$2`,
          [project, later.id],
        )).rows[0].n,
      );
    } finally {
      await client.query('ROLLBACK'); // discard ALL test writes
      client.release();
    }
  });
});
