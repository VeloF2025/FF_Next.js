if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PP_EXIT_REASONS } from '../../src/modules/action-centre/ppExitReasons';

const SCHEMA = 'mig524_oes_pp_exit_reason_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL as string;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA},public`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const MIG_524 = readFileSync(join(SQL_DIR, '524_oes_pp_exit_reason.sql'), 'utf8');
const ROLLBACK_524 = readFileSync(join(SQL_DIR, 'rollback_524_oes_pp_exit_reason.sql'), 'utf8');

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

// Mirrors the columns of public.oes_pp_data that 524 depends on, checked against
// the live table on 2026-08-22. activated_at and the 377 lifecycle constraint are
// included because the whole point of 524 is that decommissioned_at CANNOT
// express a non-activation exit — a fixture without that constraint would let a
// wrong design pass.
const PREREQUISITE = `
  -- exit_reason_by FKs to users(id), so the fixture needs the referenced table.
  -- Only the referenced column is modelled: a wider hand-rolled users table would
  -- drift from production without the FK caring.
  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid()
  );
  CREATE TABLE oes_pp_data (
    id                    SERIAL PRIMARY KEY,
    serial_number         TEXT NOT NULL,
    project               TEXT NOT NULL,
    date_registered       DATE,
    resolution_status     TEXT NOT NULL DEFAULT 'not_found',
    activated_at          TIMESTAMPTZ,
    decommissioned_at     TIMESTAMPTZ,
    decommissioned_reason TEXT,
    updated_at            TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT oes_pp_data_lifecycle_order_check CHECK (
      decommissioned_at IS NULL
      OR (activated_at IS NOT NULL AND decommissioned_at >= activated_at)
    )
  );
`;

async function seedOpenRow(serial = 'ALCL0000001'): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO oes_pp_data (serial_number, project, date_registered)
     VALUES ($1, 'TEST', '2026-01-01') RETURNING id`,
    [serial],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
  await db.end();
});

beforeEach(async () => {
  await db.query(`DROP SCHEMA ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
  await db.query(PREREQUISITE);
  await db.query(MIG_524);
});

describe('524 — PP exit reason', () => {
  it('accepts every reason the API will send', async () => {
    // The API validates against its own list and the database against the CHECK.
    // If they drift, a request passes validation and then dies as a 23514 after
    // the caller has been told nothing is wrong. Driving the DB from the API's
    // own exported constant is what makes that drift impossible to ship.
    for (const reason of PP_EXIT_REASONS) {
      const id = await seedOpenRow(`ALCL${reason}`);
      await expect(
        db.query(
          `UPDATE oes_pp_data SET exit_reason = $2, exit_reason_at = now() WHERE id = $1`,
          [id, reason],
        ),
      ).resolves.toBeTruthy();
    }
  });

  it('rejects a reason outside the list', async () => {
    const id = await seedOpenRow();
    await expect(
      db.query(
        `UPDATE oes_pp_data SET exit_reason = 'made_up', exit_reason_at = now() WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/oes_pp_data_exit_reason_check/);
  });

  it('refuses a reason with no timestamp, and a timestamp with no reason', async () => {
    // Half-set is worse than unset: a reason with no date is invisible to every
    // dated metric, and a date with no reason counts as an exit attributable to
    // nothing.
    const a = await seedOpenRow('ALCL_A');
    await expect(
      db.query(`UPDATE oes_pp_data SET exit_reason = 'unknown' WHERE id = $1`, [a]),
    ).rejects.toThrow(/coherence/);

    const b = await seedOpenRow('ALCL_B');
    await expect(
      db.query(`UPDATE oes_pp_data SET exit_reason_at = now() WHERE id = $1`, [b]),
    ).rejects.toThrow(/coherence/);
  });

  it('lets a NEVER-ACTIVATED row exit, which decommissioned_at cannot express', async () => {
    // This is the reason 524 exists. The 377 constraint requires activated_at to
    // be set before decommissioned_at, so the 1,168 rows that never activated
    // have no exit path through 377 at all.
    const id = await seedOpenRow();
    await expect(
      db.query(`UPDATE oes_pp_data SET decommissioned_at = now() WHERE id = $1`, [id]),
    ).rejects.toThrow(/lifecycle_order/);

    await db.query(
      `UPDATE oes_pp_data SET exit_reason = 'ont_faulty', exit_reason_at = now() WHERE id = $1`,
      [id],
    );
    const { rows } = await db.query<{ exit_reason: string }>(
      `SELECT exit_reason FROM oes_pp_data WHERE id = $1`,
      [id],
    );
    expect(rows[0].exit_reason).toBe('ont_faulty');
  });

  it('does NOT block a row that exits and later activates', async () => {
    // Deliberate: the nightly OES import sets activated_at, so a constraint
    // forbidding both would let a returning customer ABORT THE IMPORT. A row
    // carrying both is a harmless record of a re-entry.
    const id = await seedOpenRow();
    await db.query(
      `UPDATE oes_pp_data SET exit_reason = 'customer_cancelled', exit_reason_at = now() WHERE id = $1`,
      [id],
    );
    await expect(
      db.query(`UPDATE oes_pp_data SET activated_at = now() WHERE id = $1`, [id]),
    ).resolves.toBeTruthy();
  });

  it('attributes the exit to a real user, and survives that user being erased', async () => {
    // Every other `_by UUID` column in this schema FKs to users(id). ON DELETE
    // SET NULL, not RESTRICT: who classified a row must never be a reason a
    // POPIA erasure cannot proceed, and the reason itself outlives the author.
    const { rows: u } = await db.query<{ id: string }>(
      `INSERT INTO users DEFAULT VALUES RETURNING id`,
    );
    const userId = u[0].id;
    const id = await seedOpenRow();

    await expect(
      db.query(
        `UPDATE oes_pp_data SET exit_reason = 'no_access', exit_reason_at = now(),
                exit_reason_by = '00000000-0000-4000-8000-000000000000' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await db.query(
      `UPDATE oes_pp_data SET exit_reason = 'no_access', exit_reason_at = now(),
              exit_reason_by = $2 WHERE id = $1`,
      [id, userId],
    );
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);

    const { rows } = await db.query<{ exit_reason: string; exit_reason_by: string | null }>(
      `SELECT exit_reason, exit_reason_by FROM oes_pp_data WHERE id = $1`,
      [id],
    );
    expect(rows[0].exit_reason).toBe('no_access');
    expect(rows[0].exit_reason_by).toBeNull();
  });

  it('is re-runnable, and the rollback is too', async () => {
    await expect(db.query(MIG_524)).resolves.toBeTruthy();
    await db.query(`SET search_path TO ${SCHEMA}, public`);
    await expect(db.query(ROLLBACK_524.replace(/DELETE FROM schema_migrations[\s\S]*?;/, ''))).resolves.toBeTruthy();
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'oes_pp_data' AND column_name LIKE 'exit_reason%'`,
      [SCHEMA],
    );
    expect(rows[0].n).toBe('0');
  });
});
