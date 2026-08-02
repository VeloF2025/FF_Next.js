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
 * A data-driven sweep over `projects` is deliberately NOT performed: the
 * migration-test container is seeded with a single row ('Test Project A'), so it
 * would prove almost nothing while looking thorough. Coverage comes from the
 * explicit sample list plus both parity directions above.
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
  CANONICAL_NAMES,
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

  it('every mapping in the shipped SQL matches BOTH the TypeScript and real SQL', async () => {
    const mappings = parseSqlMappings(FORWARD);
    // EXACT count, not a floor. A `> 15` threshold would let several of the 21
    // branches go missing while still reporting success — the parser could
    // silently stop matching and the test would stay green.
    //   1 empty-string case + 3 aliases + 17 canonical names = 21
    expect(mappings.length).toBe(21);

    for (const [input, expected] of mappings) {
      // Checking the parsed pair against TypeScript alone proves nothing about
      // the deployed function, so execute it too.
      expect(canonicalProject(input), `TS for SQL mapping ${JSON.stringify(input)}`).toBe(expected);
      expect(await sqlCanonical(input), `SQL for its own mapping ${JSON.stringify(input)}`).toBe(
        expected
      );
    }
  });

  it('every TypeScript alias matches the SQL', async () => {
    for (const [alias, expected] of PROJECT_ALIASES) {
      expect(await sqlCanonical(alias), `alias ${alias}`).toBe(expected);
      expect(canonicalProject(alias)).toBe(expected);
    }
  });

  it('every canonical name in the TypeScript vocabulary matches the SQL', async () => {
    // The reverse direction the alias loop misses: a name present in TS but absent
    // from the SQL CASE would fold in one place and pass through in the other.
    for (const name of CANONICAL_NAMES) {
      expect(await sqlCanonical(name), `canonical ${name}`).toBe(name);
      expect(await sqlCanonical(name.toUpperCase()), `upper ${name}`).toBe(canonicalProject(name.toUpperCase()));
    }
  });

  it('SQL and TypeScript trim the SAME whitespace characters', async () => {
    // Single-argument btrim strips only U+0020 while JS .trim() strips all Unicode
    // whitespace, so this pairing silently diverged until both sides named the set.
    for (const s of ['\tTEM\t', '\nTEM\r\n', '\u00a0TEM\u00a0', '\u00a0', '\t', ' \t TEM \t ']) {
      expect(await sqlCanonical(s), `whitespace ${JSON.stringify(s)}`).toBe(canonicalProject(s));
    }
  });

  it('SQL and TypeScript trim EXACTLY the same character set', async () => {
    // Names any character one side trims and the other does not, rather than
    // trusting that two hand-written lists match. Sweeps every C0 control plus the
    // Unicode space characters most likely to arrive from a spreadsheet export.
    const candidates = [
      // From 0x01: PostgreSQL text cannot represent U+0000 at all ("invalid byte
      // sequence for encoding UTF8: 0x00"), so no project name can ever carry one
      // through a column and parity on it is unreachable, not merely untested.
      ...Array.from({ length: 0x1f }, (_, i) => String.fromCharCode(i + 1)), // C0 controls
      '\u0020', '\u00a0', '\u1680', '\u2000', '\u2001', '\u2002', '\u2003',
      '\u2007', '\u2008', '\u2009', '\u200a', '\u2028', '\u2029', '\u202f',
      '\u205f', '\u3000', '\ufeff',
    ];
    const divergent: string[] = [];
    for (const c of candidates) {
      const probe = `${c}TEM${c}`;
      const [fromSql, fromTs] = [await sqlCanonical(probe), canonicalProject(probe)];
      if (fromSql !== fromTs) divergent.push(`U+${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    }
    expect(divergent, `characters trimmed by only one side: ${divergent.join(', ')}`).toEqual([]);
  });

  it('does not eat a leading or trailing letter v (the E\'\\v\' trap)', async () => {
    // PostgreSQL's E'' does not implement \v, so E'\v' is the LITERAL letter 'v'.
    // Writing the trim set as E' \t\n\r\f\v' therefore put 'v' in it and made
    // btrim('velo', ...) return 'elo'. 'Velo Test' is a real project value in this
    // database, so this was live data corruption. Vertical tab must be \013.
    expect(await sqlCanonical('velo')).toBe('velo');
    expect(await sqlCanonical('Velo Test v')).toBe('Velo Test v');
    expect(await sqlCanonical('velo')).toBe(canonicalProject('velo'));
    // ...while the real vertical tab is still trimmed.
    expect(await sqlCanonical('\u000bTEM\u000b')).toBe('Thembisa POP 1');
  });

  it('SQL and TypeScript agree on prototype-shaped keys', async () => {
    // An object-literal lookup returned Object.prototype for '__proto__' and a
    // function for 'constructor'; SQL passes both through as plain strings.
    for (const s of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(await sqlCanonical(s), `prototype key ${s}`).toBe(canonicalProject(s));
      expect(typeof canonicalProject(s)).toBe('string');
    }
  });

  it('the database collation lowercases ASCII the way TypeScript does', async () => {
    // lower() follows the database collation. Under a Turkish collation
    // lower('MIDDELBURG') yields a dotless i and the mapping would miss, while JS
    // is locale-independent. This DB is en_US.UTF-8; pinned so a collation change
    // surfaces here rather than as quietly unmatched projects.
    const rows = await scoped<{ ok: boolean }>(
      `SELECT lower('MIDDELBURG') = 'middelburg' AS ok`
    );
    expect(rows[0]?.ok).toBe(true);
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
