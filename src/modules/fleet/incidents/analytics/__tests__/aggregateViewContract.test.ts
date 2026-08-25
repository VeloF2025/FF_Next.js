/**
 * The published view is only worth having if nothing bypasses it.
 *
 * `fleet_operational_monthly_aggregates` keeps every superseded generation as
 * `is_active = false`, and those rows are the disclosive ones — a month is
 * recomputed to fewer rows exactly when the anonymity threshold is raised, so
 * the retired generation is the one that published groups now judged too small.
 * A query that forgets `AND is_active = true` does not fail; it returns MORE
 * rows, and the extra rows are the withheld groups.
 *
 * Migration 527 hard-codes the predicate in a view. These tests make using it
 * mandatory: the database still permits a direct read (see the migration header
 * for why the grant cannot be withdrawn yet), so this is the layer that catches
 * a reader going around it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_AGGREGATE_COLUMNS, PUBLISHED_DIMENSION_LEVELS, PUBLISHED_VIEW_COLUMNS } from '../aggregateSchema';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
const MIGRATION = join(REPO_ROOT, 'scripts', 'migrations', 'sql', '527_fleet_aggregates_published_view.sql');
const ROLLBACK = join(REPO_ROOT, 'scripts', 'migrations', 'sql', 'rollback_527_fleet_aggregates_published_view.sql');
const VIEW_NAME = 'fleet_operational_monthly_aggregates_published';
const BASE_TABLE = 'fleet_operational_monthly_aggregates';

/**
 * The writer legitimately names the base table: it is the only thing that may
 * INSERT or UPDATE a generation, and a view is not what you write through.
 * Every other file must go through the view.
 */
const WRITER_FILES = [
  'src/modules/fleet/incidents/analytics/aggregateRepository.ts',
  // The migrations that CREATE the table and the view over it. A migration is
  // the one place the base table has to be named, and naming it there is not a
  // read path.
  'scripts/migrations/sql/518_fleet_operational_analytics_retention.sql',
  'scripts/migrations/sql/rollback_518_fleet_operational_analytics_retention.sql',
  'scripts/migrations/sql/527_fleet_aggregates_published_view.sql',
  'scripts/migrations/sql/rollback_527_fleet_aggregates_published_view.sql',
];

/**
 * Where a query can be written. The frame started as `src/modules/fleet` alone,
 * which excluded the `pages/api/**` handlers that write raw SQL, all of
 * `src/services` and `src/lib`, every script, and every `.js` and `.mjs` file
 * anywhere. The App Router tree — 233 more `.ts`/`.tsx` files — and raw `.sql`
 * were still missing after the first widening. A guard that cannot see the
 * directory the next reader will put their query in is not a guard, and the way
 * that keeps being discovered is by someone naming a directory it forgot.
 */
const SCANNED_ROOTS = ['app', 'pages', 'src', 'scripts', 'lib'];
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs|sql)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

const forward = readFileSync(MIGRATION, 'utf8');

/** The view's SELECT list, as written in the migration. */
function selectedColumns(): string[] {
  const body = /AS\s*\nSELECT([\s\S]*?)FROM fleet_operational_monthly_aggregates/.exec(forward);
  expect(body).not.toBeNull();
  return body![1]!.split(',').map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * The table in a SQL position, not in prose — several modules name it in a doc
 * comment to explain what may not reach it, and flagging those would train the
 * next person to delete the explanation rather than the query.
 *
 * Between the keyword and the name: any run of whitespace, brackets or quotes,
 * then an optional schema qualification — quoted or not — then an optional
 * opening quote. The trailing `(?!\\w)` keeps the view (…_published) out — `_` is
 * a word character, so no `\\b` falls between the name and its suffix — while
 * still allowing the closing double quote of a quoted identifier.
 *
 * The keyword list is every way SQL names a relation it is about to read or
 * write, not just the four a first draft thought of.
 *
 * Built fresh on each call: the `g`-less form has no lastIndex to carry, but a
 * shared literal is the kind of thing a later edit makes stateful by accident.
 */
function basePattern(): RegExp {
  return new RegExp(
    '(FROM|JOIN|INTO|UPDATE|COPY|MERGE|TRUNCATE(\\s+TABLE)?(\\s+ONLY)?)'
    + `[\\s("]+(?:"?public"?\\s*\\.\\s*)?"?${BASE_TABLE}(?!\\w)`,
    'i',
  );
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { found.push(...sourceFiles(full)); continue; }
    if (SCANNED_EXTENSIONS.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Tests may name the base table: they are what proves the writer still reaches
 * it. The exemption is scoped to files VITEST ACTUALLY RUNS — a module's own
 * `__tests__` directory, or the repository's `tests/` tree — so a `.test.` file
 * dropped anywhere else cannot excuse itself. `__tests__` anywhere in the path
 * used to be enough, which would have excused such a directory in any module in
 * the repository.
 */
function exemptFromScan(relativePath: string): boolean {
  const isTestFile = /(^|\/)[^/]*\.test\.[jt]sx?$/.test(relativePath);
  if (!isTestFile) return false;
  return relativePath.startsWith('tests/') || relativePath.includes('/__tests__/');
}

function scannedFiles(): string[] {
  const found: string[] = [];
  for (const root of SCANNED_ROOTS) {
    const full = join(REPO_ROOT, root);
    if (!existsSync(full)) continue;
    found.push(...sourceFiles(full));
  }
  return found;
}

describe('migration 527 publishes exactly the columns the allow-list names', () => {
  it('selects every column the allow-list names, and no other', () => {
    expect(selectedColumns()).toEqual([...PUBLISHED_VIEW_COLUMNS]);
  });

  it('publishes neither a contributor count nor any histogram column', () => {
    // Both were disclosure CHANNELS, not metadata. `cc(scheduled) - cc(confirmed)`
    // names one person as surely as any numerator difference; `sum_seconds` over
    // a single sample IS that person's exact duration. They stay in the base
    // table, where the writer needs them; they are not published.
    for (const column of ['contributor_count', 'sample_count', 'sum_seconds']) {
      expect(selectedColumns()).not.toContain(column);
    }
    expect(selectedColumns().filter((column) => column.startsWith('bucket_'))).toEqual([]);
  });

  it('does not publish the checksum, which would give the dropped columns back', () => {
    // The digest is taken over a fixed field order that includes
    // `contributor_count`, `sample_count`, `sum_seconds` and the buckets — and
    // every OTHER field in that preimage is published. `canonicalize` is in the
    // repository. Publishing the digest hands a reader a sha256 with one small
    // unknown in it, which is not a hash, it is an encoding.
    expect(selectedColumns()).not.toContain('checksum');
    // It stays on the base table: the writer compares generations there.
    expect([...PUBLIC_AGGREGATE_COLUMNS]).toContain('checksum');
  });

  it('does not publish generalized_from_level, which now says nothing', () => {
    // No site row is written, so a project row is always generalized from
    // site; and the organisation publishes only over projects that are all-in
    // or all-out, so the column reads the same on every organisation row of a
    // given tier. A column whose value is a function of its level is not
    // information.
    expect(selectedColumns()).not.toContain('generalized_from_level');
  });

  it('publishes organisation and project rows only', () => {
    expect(forward).toMatch(/dimension_level IN \('organisation', 'project'\)/);
    expect([...PUBLISHED_DIMENSION_LEVELS]).toEqual(['organisation', 'project']);
    expect([...PUBLISHED_DIMENSION_LEVELS]).not.toContain('site');
  });

  it('hard-codes the active predicate', () => {
    expect(forward).toMatch(/WHERE is_active = true/);
  });

  it('is a security barrier, so a leaky predicate cannot outrun the filter', () => {
    expect(forward).toMatch(/WITH \(security_barrier = true\)/);
  });

  it('grants the view to the application role', () => {
    expect(forward).toMatch(new RegExp(`GRANT SELECT ON ${VIEW_NAME} TO fibreflow_user`));
  });

  it('has a rollback that drops only the view', () => {
    const rollback = readFileSync(ROLLBACK, 'utf8');
    expect(rollback).toMatch(new RegExp(`DROP VIEW IF EXISTS ${VIEW_NAME}`));
    expect(rollback).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/);
  });
});

describe('nothing reads the base table behind the view', () => {
  it('queries the base table only in the writer', () => {
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const relativePath = relative(REPO_ROOT, file).split('\\').join('/');
      if (WRITER_FILES.includes(relativePath)) continue;
      if (exemptFromScan(relativePath)) continue;
      if (basePattern().test(readFileSync(file, 'utf8'))) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });

  it('scans the roots a query could actually be written in', () => {
    // The frame is the guard. If this ever shrinks back to one module, the
    // assertion above passes for the wrong reason.
    const scanned = scannedFiles().map((file) => relative(REPO_ROOT, file).split('\\').join('/'));
    expect(scanned.some((path) => path.startsWith('app/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('pages/api/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('src/services/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('scripts/'))).toBe(true);
    expect(scanned.some((path) => path.endsWith('.js') || path.endsWith('.mjs'))).toBe(true);
    expect(scanned.some((path) => path.endsWith('.sql'))).toBe(true);
    expect(scanned.length).toBeGreaterThan(1000);
  });

  it('catches the schema-qualified and quoted spellings of the same read', () => {
    // The first version of this pattern demanded whitespace straight after the
    // keyword and nothing between it and the bare name, so `public.` or a pair
    // of double quotes walked past it.
    for (const bypass of [
      'SELECT * FROM public.fleet_operational_monthly_aggregates',
      'SELECT * FROM "public".fleet_operational_monthly_aggregates',
      'TRUNCATE fleet_operational_monthly_aggregates',
      'TRUNCATE TABLE fleet_operational_monthly_aggregates',
      'TRUNCATE TABLE ONLY fleet_operational_monthly_aggregates',
      'SELECT * FROM public . fleet_operational_monthly_aggregates',
      'SELECT * FROM "public" . "fleet_operational_monthly_aggregates"',
      'COPY fleet_operational_monthly_aggregates TO STDOUT',
      'MERGE INTO fleet_operational_monthly_aggregates AS target',
      'SELECT * FROM "fleet_operational_monthly_aggregates"',
      'SELECT * FROM public."fleet_operational_monthly_aggregates"',
      'SELECT * FROM\n  fleet_operational_monthly_aggregates',
      'JOIN(fleet_operational_monthly_aggregates)',
      'update public.fleet_operational_monthly_aggregates set is_active = false',
    ]) {
      expect(basePattern().test(bypass)).toBe(true);
    }
  });

  it('still lets the view and prose through', () => {
    for (const allowed of [
      'SELECT * FROM fleet_operational_monthly_aggregates_published',
      'SELECT * FROM public."fleet_operational_monthly_aggregates_published"',
      '// nothing may read fleet_operational_monthly_aggregates directly',
    ]) {
      expect(basePattern().test(allowed)).toBe(false);
    }
  });

  /**
   * The retention gate no longer reads aggregates at all — migration 528 gave
   * it a recorded fact to read instead, because counting published rows made a
   * correctly-aggregated month that published nothing look like a month that
   * was never aggregated.
   *
   * This assertion is kept rather than deleted, re-pointed at the relation the
   * gate should now name. Its job was never "mentions the view"; it was "the
   * gate reads the thing it is supposed to read", and dropping it entirely
   * would let the gate be quietly rewritten against anything at all while the
   * base-table scan above stayed green.
   */
  it('reads recorded coverage, not aggregates, in the retention gate', () => {
    const retention = readFileSync(
      join(REPO_ROOT, 'src', 'modules', 'fleet', 'incidents', 'retention', 'retentionRepository.ts'), 'utf8',
    );
    expect(retention).toContain('fleet_operational_aggregate_month_coverage');
    // And not through the view either: a gate reading both would be two
    // answers to one question.
    expect(retention).not.toContain(VIEW_NAME);
  });
});
