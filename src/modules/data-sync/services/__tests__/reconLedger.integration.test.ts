/**
 * Live-DB integration test for v_dr_reconciliation_ledger (migration 414).
 *
 * The unit tests cover the query-builder; this gate validates the VIEW's actual
 * recon_class classification against real data — the logic lives in SQL, so the
 * only honest way to test "each recon_class case" is to run it against the DB and
 * assert that NO row in the whole view violates its class invariant (a violation
 * COUNT, not a sample). It also EXPLAINs the production select (no ANALYZE → parses
 * + plans against the live schema without executing) so a column/view rename fails
 * loud here instead of at request time.
 *
 * Gating: skipped unless SUPABASE_INTEGRATION_TEST=true. Requires
 * SUPABASE_INTEGRATION_DB_URL (vitest.setup.ts overwrites DATABASE_URL for unit
 * isolation). Run locally with:
 *
 *   SUPABASE_INTEGRATION_TEST=true \
 *   SUPABASE_INTEGRATION_DB_URL=postgresql://... \
 *     npx vitest run src/modules/data-sync/services/__tests__/reconLedger.integration.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Pool } from 'pg';
import { LEDGER_COLUMNS, RECON_CLASSES } from '../reconLedgerQuery';

const INTEGRATION_ENABLED = process.env.SUPABASE_INTEGRATION_TEST === 'true';

// recon_class → SQL predicate that must hold for EVERY row of that class.
// A row of class X failing predicate(X) is a classification bug.
const SERIAL_CONFLICT = `(distinct_serial_count > 1 OR onemap_fix_status = 'serial_other_dr')`;
const WA_NO_OES = `(has_wa_submission AND NOT has_oes_activation)`;
const OES_NO_1MAP = `(has_oes_activation AND onemap_fix_status IN
                 ('not_found','empty_serial','pending','needs_investigation','needs_reinvestigation','escalated'))`;
const DEDUCTED_ACTIVE = `(has_oes_activation AND payment_status = 'deducted' AND oes_status = 'Active')`;
const ALL_AGREE = `(has_oes_activation AND distinct_serial_count <= 1
               AND (onemap_fix_status IS NULL OR onemap_fix_status IN ('fixed','resolved')))`;

const CLASS_INVARIANTS: Record<string, string> = {
  serial_other_dr: SERIAL_CONFLICT,
  wa_no_oes: WA_NO_OES,
  oes_no_1map: OES_NO_1MAP,
  deducted_but_active: DEDUCTED_ACTIVE,
  all_agree: ALL_AGREE,
  // no_evidence is the ELSE bucket: by construction it must NOT satisfy any of the
  // five positive class predicates (otherwise the CASE would have matched earlier).
  // This is a real negative invariant, not a TRUE tautology.
  no_evidence: `NOT (${SERIAL_CONFLICT} OR ${WA_NO_OES} OR ${OES_NO_1MAP} OR ${DEDUCTED_ACTIVE} OR ${ALL_AGREE})`,
};

describe.skipIf(!INTEGRATION_ENABLED)('v_dr_reconciliation_ledger (live DB)', () => {
  let pool: Pool;

  beforeAll(() => {
    const connectionString = process.env.SUPABASE_INTEGRATION_DB_URL;
    if (!connectionString) throw new Error('SUPABASE_INTEGRATION_DB_URL is required when SUPABASE_INTEGRATION_TEST=true');
    pool = new Pool({ connectionString, max: 2 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('EXPLAINs the production select against the live schema', async () => {
    const sql = `EXPLAIN (VERBOSE) SELECT ${LEDGER_COLUMNS}
      FROM v_dr_reconciliation_ledger
      WHERE recon_class = $1
      ORDER BY COALESCE(oes_activated_at, wa_submitted_at) DESC NULLS LAST, drop_number
      LIMIT $2 OFFSET $3`;
    const res = await pool.query(sql, ['serial_other_dr', 50, 0]);
    expect(res.rows.length).toBeGreaterThan(0); // a query plan came back → it parsed
  });

  it('emits exactly the six known recon_class values, never NULL', async () => {
    const res = await pool.query(`SELECT DISTINCT recon_class FROM v_dr_reconciliation_ledger`);
    const seen = res.rows.map((r) => r.recon_class);
    expect(seen).not.toContain(null);
    // Full set equality — every known class is present AND no unknown class leaks.
    expect(new Set(seen)).toEqual(new Set(RECON_CLASSES));
  });

  it('has one ledger row per DR — count matches the v_dr_installation_status spine', async () => {
    const res = await pool.query(
      `SELECT (SELECT count(*) FROM v_dr_reconciliation_ledger) AS ledger,
              (SELECT count(*) FROM v_dr_installation_status)  AS spine`
    );
    expect(res.rows[0].ledger).toBe(res.rows[0].spine);
  });

  it.each(Object.entries(CLASS_INVARIANTS))(
    'every row classed %s satisfies its invariant (0 violations)',
    async (cls, invariant) => {
      const res = await pool.query(
        `SELECT count(*)::int AS violations
         FROM v_dr_reconciliation_ledger
         WHERE recon_class = $1 AND NOT (${invariant})`,
        [cls]
      );
      expect(res.rows[0].violations).toBe(0);
    }
  );

  it('classifies the DR1752844 envelope case as all_agree, not serial_other_dr', async () => {
    // wa = oes = drops = ALCLB4659A83 but onemap holds the raw DataMatrix envelope;
    // the shape normaliser must drop the envelope so this is NOT a false conflict.
    const res = await pool.query(
      `SELECT recon_class, distinct_serial_count
       FROM v_dr_reconciliation_ledger WHERE drop_number = 'DR1752844'`
    );
    expect(res.rows.length).toBe(1); // must exist in live data — no silent skip
    expect(res.rows[0].distinct_serial_count).toBeLessThanOrEqual(1);
    expect(res.rows[0].recon_class).not.toBe('serial_other_dr');
  });

  it('stale-snapshot guard: no fixed/resolved-1Map DR is left as serial_other_dr by its 1Map leg alone', async () => {
    // When onemap_fix_status IN ('fixed','resolved') the 1Map intake snapshot is
    // dropped from the conflict count. So any such DR still classed serial_other_dr
    // MUST owe that to a non-1Map leg disagreeing (wa/oes/drops), never to the stale
    // onemap snapshot. Verify there are fixed/resolved rows (test actually runs) and
    // that none are serial_other_dr purely because onemap differs.
    const present = await pool.query(
      `SELECT count(*)::int AS n FROM v_dr_reconciliation_ledger
       WHERE onemap_fix_status IN ('fixed','resolved')`
    );
    expect(present.rows[0].n).toBeGreaterThan(0);

    const leak = await pool.query(
      `SELECT count(*)::int AS violations
       FROM v_dr_reconciliation_ledger
       WHERE onemap_fix_status IN ('fixed','resolved')
         AND recon_class = 'serial_other_dr'
         -- the three non-1Map legs all agree (≤1 distinct), so the only thing that
         -- could have tripped the conflict is the (now-dropped) stale 1Map snapshot:
         AND cardinality(ARRAY(
               SELECT DISTINCT s FROM unnest(ARRAY[
                 CASE WHEN upper(trim(wa_serial))    ~ '^[A-Z0-9]{6,}$' THEN upper(trim(wa_serial))    END,
                 CASE WHEN upper(trim(oes_serial))   ~ '^[A-Z0-9]{6,}$' THEN upper(trim(oes_serial))   END,
                 CASE WHEN upper(trim(drops_serial)) ~ '^[A-Z0-9]{6,}$' THEN upper(trim(drops_serial)) END
               ]) s WHERE s IS NOT NULL)) <= 1
         AND onemap_fix_status <> 'serial_other_dr'`
    );
    expect(leak.rows[0].violations).toBe(0);
  });
});
