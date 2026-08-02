/**
 * Integration test for migration 477 — canonical_project().
 *
 * The alias map exists twice: once in SQL (grouping happens in the database) and
 * once in TypeScript (`src/modules/metrics/dimensions/canonical.ts`). Two copies of
 * the same vocabulary WILL drift, and when they do the failure is silent — one
 * metric groups 'TEM' under Thembisa POP 1 while another leaves it as 'TEM', and
 * the two simply cannot be added together. Nothing errors.
 *
 * So parity is asserted BIDIRECTIONALLY:
 *   - every mapping the TypeScript knows about is checked against real SQL, and
 *   - every `WHEN ... THEN ...` parsed out of the shipped .sql file is checked
 *     against the TypeScript.
 * Adding an entry to either side alone fails this test.
 *
 * A data-driven sweep over `projects` is deliberately NOT the primary check: the
 * migration-test container is seeded with a single row ('Test Project A'), so it
 * would prove almost nothing while looking thorough.
 *
 * SAFETY: the function is created in a scratch schema dropped in afterAll.
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
import {
  canonicalProject,
  PROJECT_ALIASES,
  UNKNOWN_PROJECT,
} from '@/modules/metrics/dimensions/canonical';

const SCHEMA = 'mig477_scratch';
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '477_conformed_project_dimension.sql'), 'utf8');
const ROLLBACK = readFileSync(
  join(SQL_DIR, 'rollback_477_conformed_project_dimension.sql'),
  'utf8'
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

async function scoped<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    const r = await client.query(sql, params);
    return (r.rows ?? []) as T[];
  } finally {
    client.release();
  }
}

/** Run the real SQL function. */
async function sqlCanonical(input: string | null): Promise<string> {
  const rows = await scoped<{ v: string }>(`SELECT canonical_project($1::text) AS v`, [input]);
  return rows[0]!.v;
}

/**
 * Pull every `WHEN '<in>' THEN '<out>'` out of the shipped SQL so the test can
 * check the direction the TypeScript cannot see. `''` is Postgres's escaped
 * single quote and unescapes to `'`.
 */
function parseSqlMappings(sql: string): Array<[string, string]> {
  const body = sql.slice(sql.indexOf('CASE'));
  const re = /WHEN\s+'((?:[^']|'')*)'\s+THEN\s+'((?:[^']|'')*)'/g;
  const out: Array<[string, string]> = [];
  for (const m of body.matchAll(re)) {
    out.push([m[1]!.replace(/''/g, "'"), m[2]!.replace(/''/g, "'")]);
  }
  return out;
}

beforeAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await scoped(`CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz DEFAULT NOW())`);
  await scoped(FORWARD);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

describe('canonical_project — parity with TypeScript', () => {
  const SAMPLES = [
    'TEM', 'TEM-3', 'ETW-2', 'tem-3', '  tem  ', 'etw-2',
    'Lawley', 'lawley', ' LAWLEY ', 'Mohadin', 'Etwatwa',
    'Middelburg ', 'Middelburg', "Themb'elihle", 'Thembisa POP 1', 'Thembisa POP 3',
    'General / Equipment', 'Phalaborwa - Ben Farm', 'Phalabrowa - Namakgale',
    'Brand New Site', 'Marketing', 'Velo Test', '', '   ',
  ];

  it('SQL and TypeScript agree on every sample', async () => {
    for (const s of SAMPLES) {
      const fromSql = await sqlCanonical(s);
      expect(fromSql, `mismatch for ${JSON.stringify(s)}`).toBe(canonicalProject(s));
    }
  });

  it('SQL and TypeScript agree on NULL', async () => {
    expect(await sqlCanonical(null)).toBe(canonicalProject(null));
    expect(await sqlCanonical(null)).toBe(UNKNOWN_PROJECT);
  });

  it('every mapping in the shipped SQL matches the TypeScript', async () => {
    const mappings = parseSqlMappings(FORWARD);
    // Guard the parser itself: a regex that silently matches nothing would make
    // this test vacuous while reporting success.
    expect(mappings.length).toBeGreaterThan(15);
    for (const [input, expected] of mappings) {
      expect(canonicalProject(input), `SQL maps ${JSON.stringify(input)} -> ${expected}`).toBe(
        expected
      );
    }
  });

  it('every TypeScript alias matches the SQL', async () => {
    for (const [alias, expected] of Object.entries(PROJECT_ALIASES)) {
      expect(await sqlCanonical(alias), `alias ${alias}`).toBe(expected);
      expect(canonicalProject(alias)).toBe(expected);
    }
  });
});

describe('canonical_project — behaviour', () => {
  it('keeps TEM and TEM-3 as DIFFERENT projects', async () => {
    // The whole point of the migration. Folding these merges Thembisa POP 1 and
    // POP 3 into one number.
    expect(await sqlCanonical('TEM')).toBe('Thembisa POP 1');
    expect(await sqlCanonical('TEM-3')).toBe('Thembisa POP 3');
    expect(await sqlCanonical('TEM')).not.toBe(await sqlCanonical('TEM-3'));
  });

  it('folds TEM-3 and ETW-2 away entirely — they must not survive as labels', async () => {
    const folded = await Promise.all(['TEM-3', 'ETW-2', 'TEM'].map(sqlCanonical));
    expect(folded).not.toContain('TEM-3');
    expect(folded).not.toContain('ETW-2');
    expect(folded).not.toContain('TEM');
  });

  it('is idempotent — folding an already-canonical name returns it unchanged', async () => {
    for (const name of ['Thembisa POP 1', 'Thembisa POP 3', 'Etwatwa', 'Lawley', 'Middelburg']) {
      expect(await sqlCanonical(name), `idempotent for ${name}`).toBe(name);
    }
  });

  it('passes an unmapped project through rather than dropping or bucketing it', async () => {
    expect(await sqlCanonical('Brand New Site')).toBe('Brand New Site');
    expect(await sqlCanonical('  Brand New Site  ')).toBe('Brand New Site');
  });

  it('is IMMUTABLE, so it can back an index', async () => {
    const rows = await scoped<{ provolatile: string }>(
      `SELECT provolatile FROM pg_proc WHERE proname = 'canonical_project'
       AND pronamespace = $1::regnamespace`,
      [SCHEMA]
    );
    expect(rows[0]?.provolatile).toBe('i');
  });

  it('actually works in a GROUP BY, which is how metrics use it', async () => {
    await scoped(`CREATE TABLE t_proj (project text)`);
    await scoped(
      `INSERT INTO t_proj (project) VALUES ('TEM'),('tem'),('TEM-3'),('Etwatwa'),('ETW-2'),(NULL)`
    );
    const rows = await scoped<{ project: string; n: string }>(
      `SELECT canonical_project(project) AS project, count(*)::text AS n
       FROM t_proj GROUP BY 1 ORDER BY 1`
    );
    const got = Object.fromEntries(rows.map((r) => [r.project, Number(r.n)]));
    expect(got).toEqual({
      'Thembisa POP 1': 2, // TEM + tem collapse
      'Thembisa POP 3': 1,
      Etwatwa: 2, // Etwatwa + ETW-2 collapse
      Unknown: 1,
    });
  });
});

describe('migration 477 — rollback', () => {
  it('drops the function and clears its tracker row, and is re-runnable', async () => {
    await scoped(
      `INSERT INTO schema_migrations (filename) VALUES ('477_conformed_project_dimension.sql')
       ON CONFLICT DO NOTHING`
    );
    await scoped(ROLLBACK);
    await scoped(ROLLBACK);

    const fns = await scoped(
      `SELECT 1 FROM pg_proc WHERE proname = 'canonical_project' AND pronamespace = $1::regnamespace`,
      [SCHEMA]
    );
    expect(fns).toHaveLength(0);

    const tracker = await scoped(
      `SELECT 1 FROM schema_migrations WHERE filename = '477_conformed_project_dimension.sql'`
    );
    expect(tracker).toHaveLength(0);
  });
});
