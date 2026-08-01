/**
 * Integration test for migration 472 — v_pole_planning.
 *
 * A stub-client test cannot check what actually matters about this migration:
 * whether the FULL JOIN is 1:1 (a fan-out here silently multiplies every
 * "planned" count in Works QA) and whether the per-column COALESCE really
 * leaves the three SharePoint-fed projects on the values they resolve to
 * today. Both are properties of running the SQL, so this runs it.
 *
 * On the live database sow_poles and public.poles disagree far more than you
 * would guess — measured 2026-08-01: Mohadin 225 zone / 261 PON conflicts,
 * Mamelodi 5 / 88, Lawley 0 / 14. Precedence is therefore load-bearing, not
 * cosmetic, and it is pinned here.
 *
 * Sibling of 358_snag_reports_scope / 378_rbac_field_stock_force_correct /
 * 471_hs_training_certificate_upload: requires TEST_DATABASE_URL, and is
 * excluded from the unit vitest config (vitest.config.ts) because it throws at
 * module load without one.
 *
 * Being in that exclude list also means `npx vitest run <this file>` reports
 * "No test files found" — the exclusion wins over an explicit path argument,
 * and vitest 0.34 has no `--exclude` CLI override. To run it, point vitest at a
 * throwaway config (kept OUT of the repo) that reuses this project's aliases:
 *
 *   cat > vitest.tmp.config.ts <<'EOF'
 *   import base from './vitest.config';
 *   import { defineConfig } from 'vitest/config';
 *   export default defineConfig({ ...base, test: { ...(base as any).test,
 *     include: ['tests/migrations/472_works_qa_pole_planning_view.test.ts'],
 *     exclude: ['node_modules', '.next', 'dist'] } });
 *   EOF
 *   TEST_DATABASE_URL=postgres://... npx vitest run --config vitest.tmp.config.ts
 *   rm vitest.tmp.config.ts
 *
 * The config must sit inside the repo — from /tmp, Node cannot resolve
 * 'vitest/config'.
 *
 * SAFETY: everything happens in a scratch schema dropped unconditionally in
 * afterAll. The forward file hard-qualifies public.sow_poles / public.poles on
 * purpose (an onemap.poles also exists, so relying on search_path would be
 * luck) — so the test rewrites that prefix to the scratch schema. That is the
 * one deviation from the shipped SQL; the JOIN and COALESCE under test are
 * byte-identical. The rollback file is never run here: it carries an
 * unconditional DELETE against schema_migrations.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = 'mig472_scratch';
const FORWARD = readFileSync(
  join(process.cwd(), 'scripts/migrations/sql/472_works_qa_pole_planning_view.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

const PA = '11111111-1111-1111-1111-111111111111';

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(sql, params);
  return r.rows as T[];
}

beforeAll(async () => {
  await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await q(`CREATE SCHEMA ${SCHEMA}`);

  // Minimal stand-ins carrying only the columns the view reads.
  await q(`
    CREATE TABLE ${SCHEMA}.sow_poles (
      project_id uuid, pole_number varchar(255), zone_no integer, pon_no integer
    )`);
  await q(`
    CREATE TABLE ${SCHEMA}.poles (
      project_id uuid, pole_number varchar(255), zone_no integer, pon_no integer
    )`);

  await q(
    `INSERT INTO ${SCHEMA}.sow_poles (project_id, pole_number, zone_no, pon_no) VALUES
       ($1,'BOTH.AGREE',    7, 64),
       ($1,'BOTH.CONFLICT', 7, 64),
       ($1,'BOTH.SOWNULL',  NULL, NULL),
       ($1,'SOW.ONLY',      3, 30)`,
    [PA]
  );
  await q(
    `INSERT INTO ${SCHEMA}.poles (project_id, pole_number, zone_no, pon_no) VALUES
       ($1,'BOTH.AGREE',    7, 64),
       ($1,'BOTH.CONFLICT', 9, 99),
       ($1,'BOTH.SOWNULL',  9, 99),
       ($1,'POLES.ONLY',    69, 821)`,
    [PA]
  );

  await pool.query(
    FORWARD.replace(/public\./g, `${SCHEMA}.`)
  );
});

afterAll(async () => {
  await q(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined);
  await pool.end();
});

describe('migration 472 — v_pole_planning', () => {
  // Structurally 1:1, not incidentally: the view DISTINCT ON's the sow side and
  // public.poles is unique-constrained on the same key, so neither input can
  // contribute two rows for one (project_id, pole_number).
  it('is 1:1 — every (project_id, pole_number) appears exactly once', async () => {
    const rows = await q<{ pole_number: string; n: string }>(
      `SELECT pole_number, COUNT(*) AS n
         FROM ${SCHEMA}.v_pole_planning
        GROUP BY pole_number HAVING COUNT(*) > 1`
    );
    expect(rows).toEqual([]);
  });

  it('unions both sides — sow-only and poles-only rows both survive', async () => {
    const rows = await q<{ pole_number: string }>(
      `SELECT pole_number FROM ${SCHEMA}.v_pole_planning ORDER BY pole_number`
    );
    expect(rows.map((r) => r.pole_number)).toEqual([
      'BOTH.AGREE',
      'BOTH.CONFLICT',
      'BOTH.SOWNULL',
      'POLES.ONLY',
      'SOW.ONLY',
    ]);
  });

  it('sow_poles wins where the two sources conflict', async () => {
    const [row] = await q<{ zone_no: number; pon_no: number }>(
      `SELECT zone_no, pon_no FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'BOTH.CONFLICT'`
    );
    // Not 9/99 — pinning this stops a future "poles is newer so prefer it"
    // refactor from silently re-zoning Mohadin's 225 conflicting poles.
    expect(row).toEqual({ zone_no: 7, pon_no: 64 });
  });

  it('falls back per column, not per row, when sow_poles has a NULL', async () => {
    const [row] = await q<{ zone_no: number; pon_no: number }>(
      `SELECT zone_no, pon_no FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'BOTH.SOWNULL'`
    );
    expect(row).toEqual({ zone_no: 9, pon_no: 99 });
  });

  it('surfaces a QField-only project that sow_poles knows nothing about', async () => {
    const [row] = await q<{ zone_no: number; pon_no: number }>(
      `SELECT zone_no, pon_no FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'POLES.ONLY'`
    );
    // The whole point of 472: this row used to resolve to NULL/NULL and drop
    // out of the Works QA zone dropdown.
    expect(row).toEqual({ zone_no: 69, pon_no: 821 });
  });

  it('re-applying the migration is a no-op', async () => {
    await pool.query(
      FORWARD.replace(/public\./g, `${SCHEMA}.`).replace(
        /CREATE OR REPLACE VIEW v_pole_planning/,
        `CREATE OR REPLACE VIEW ${SCHEMA}.v_pole_planning`
      ).replace(/COMMENT ON VIEW v_pole_planning/, `COMMENT ON VIEW ${SCHEMA}.v_pole_planning`)
    );
    const rows = await q(`SELECT * FROM ${SCHEMA}.v_pole_planning`);
    expect(rows).toHaveLength(5);
  });

  // ── The fan-out that the DISTINCT ON exists to prevent ────────────────────
  // sow_poles is a view over sharepoint_hld_pole (a raw external feed) and has
  // no unique constraint, so a duplicate there is possible. Two call sites feed
  // this view into INSERT ... ON CONFLICT DO UPDATE, which Postgres aborts
  // outright when one arbiter key gets two candidate rows. These two tests are
  // the regression guard: the first proves the view collapses the duplicate,
  // the second proves the real consuming statement survives it.
  describe('with a duplicate (project_id, pole_number) in sow_poles', () => {
    beforeAll(async () => {
      await q(
        `INSERT INTO ${SCHEMA}.sow_poles (project_id, pole_number, zone_no, pon_no)
         VALUES ($1,'BOTH.AGREE', 8, 65)`,
        [PA]
      );
    });
    afterAll(async () => {
      await q(`DELETE FROM ${SCHEMA}.sow_poles WHERE pole_number='BOTH.AGREE' AND zone_no=8`);
    });

    it('collapses to one row instead of fanning out', async () => {
      const rows = await q<{ n: string }>(
        `SELECT COUNT(*) AS n FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'BOTH.AGREE'`
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it('resolves the duplicate deterministically', async () => {
      const [row] = await q<{ zone_no: number; pon_no: number }>(
        `SELECT zone_no, pon_no FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'BOTH.AGREE'`
      );
      expect(row).toEqual({ zone_no: 7, pon_no: 64 });
    });

    it('merges a SPLIT duplicate per column rather than picking one whole row', async () => {
      // The reason the dedup is `GROUP BY ... min(col)` and not
      // `DISTINCT ON (...) ORDER BY ...`. DISTINCT ON selects one entire row, so
      // a duplicate whose non-NULL values are split across columns loses one of
      // them: given (zone 3, pon NULL) and (zone NULL, pon 5) it returns
      // (3, NULL) and silently discards pon 5 — which the dashboard's
      // `pon_no IS NOT NULL` filter would then drop from its zone counts.
      // min() ignores NULLs per column and keeps both. This test fails on a
      // DISTINCT ON implementation.
      await q(
        `INSERT INTO ${SCHEMA}.sow_poles (project_id, pole_number, zone_no, pon_no) VALUES
           ($1,'SPLIT.DUP', 3,    NULL),
           ($1,'SPLIT.DUP', NULL, 5)`,
        [PA]
      );
      try {
        const rows = await q<{ zone_no: number; pon_no: number }>(
          `SELECT zone_no, pon_no FROM ${SCHEMA}.v_pole_planning WHERE pole_number = 'SPLIT.DUP'`
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ zone_no: 3, pon_no: 5 });
      } finally {
        await q(`DELETE FROM ${SCHEMA}.sow_poles WHERE pole_number='SPLIT.DUP'`);
      }
    });

    it('does not break INSERT ... ON CONFLICT DO UPDATE — the real call-site shape', async () => {
      // Mirrors works-qa/sync-historical.ts and syncQfieldCore.ts's second
      // upsert. Before the DISTINCT ON this raised
      // "ON CONFLICT DO UPDATE command cannot affect row a second time"
      // (reproduced against the live server 2026-08-01), 500ing the sync.
      await q(
        `CREATE TABLE IF NOT EXISTS ${SCHEMA}.pole_qa_photos (
           project_id uuid, pole_label varchar(255), zone_no integer, pon_no integer,
           PRIMARY KEY (project_id, pole_label))`
      );
      await expect(
        q(
          `INSERT INTO ${SCHEMA}.pole_qa_photos (project_id, pole_label, zone_no, pon_no)
           SELECT $1::uuid, $2, sp.zone_no, sp.pon_no
           FROM (SELECT 1) one
           LEFT JOIN ${SCHEMA}.v_pole_planning sp
             ON sp.project_id = $1::uuid AND sp.pole_number = $2
           ON CONFLICT (project_id, pole_label) DO UPDATE
           SET zone_no = COALESCE(${SCHEMA}.pole_qa_photos.zone_no, EXCLUDED.zone_no),
               pon_no  = COALESCE(${SCHEMA}.pole_qa_photos.pon_no,  EXCLUDED.pon_no)`,
          [PA, 'BOTH.AGREE']
        )
      ).resolves.not.toThrow();

      const [row] = await q<{ zone_no: number; pon_no: number }>(
        `SELECT zone_no, pon_no FROM ${SCHEMA}.pole_qa_photos WHERE pole_label = 'BOTH.AGREE'`
      );
      expect(row).toEqual({ zone_no: 7, pon_no: 64 });
    });
  });
});
