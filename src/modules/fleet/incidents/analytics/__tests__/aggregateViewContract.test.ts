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
import { PUBLIC_AGGREGATE_COLUMNS } from '../aggregateSchema';

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
const WRITER_FILES = ['src/modules/fleet/incidents/analytics/aggregateRepository.ts'];

/**
 * Where a query can be written. The old frame was `src/modules/fleet` alone,
 * which the blind review of PR #2604 pointed out excludes the 118 `.ts` files
 * under `pages/api/**` that write raw SQL, all of `src/services` and `src/lib`,
 * every script, and every `.js` and `.mjs` file anywhere. A guard that cannot
 * see the directory the next reader will put their query in is not a guard.
 */
const SCANNED_ROOTS = ['pages', 'src', 'scripts', 'lib'];
const SCANNED_EXTENSIONS = /\.(ts|tsx|js|mjs)$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', 'dist', 'build', 'coverage']);

const forward = readFileSync(MIGRATION, 'utf8');

/**
 * The table in a SQL position, not in prose — several modules name it in a doc
 * comment to explain what may not reach it, and flagging those would train the
 * next person to delete the explanation rather than the query.
 *
 * Between the keyword and the name: any run of whitespace, brackets or quotes,
 * then an optional schema qualification, then an optional opening quote. The
 * trailing `(?!\\w)` keeps the view (…_published) out — `_` is a word character,
 * so no `\\b` falls between the name and its suffix — while still allowing the
 * closing double quote of a quoted identifier.
 *
 * Built fresh on each call: the `g`-less form has no lastIndex to carry, but a
 * shared literal is the kind of thing a later edit makes stateful by accident.
 */
function basePattern(): RegExp {
  return new RegExp(
    `(FROM|JOIN|INTO|UPDATE)[\\s("]+(?:public\\.)?"?${BASE_TABLE}(?!\\w)`,
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

function scannedFiles(): string[] {
  const found: string[] = [];
  for (const root of SCANNED_ROOTS) {
    const full = join(REPO_ROOT, root);
    if (!existsSync(full)) continue;
    found.push(...sourceFiles(full));
  }
  return found;
}

describe('migration 527 publishes exactly the allow-listed surface', () => {
  it('selects every column the allow-list names, and no other', () => {
    const body = /AS\s*\nSELECT([\s\S]*?)FROM fleet_operational_monthly_aggregates/.exec(forward);
    expect(body).not.toBeNull();
    const selected = body![1]!
      .split(',')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(selected).toEqual([...PUBLIC_AGGREGATE_COLUMNS]);
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
      if (relativePath.includes('__tests__')) continue;
      if (basePattern().test(readFileSync(file, 'utf8'))) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });

  it('scans the roots a query could actually be written in', () => {
    // The frame is the guard. If this ever shrinks back to one module, the
    // assertion above passes for the wrong reason.
    const scanned = scannedFiles().map((file) => relative(REPO_ROOT, file).split('\\').join('/'));
    expect(scanned.some((path) => path.startsWith('pages/api/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('src/services/'))).toBe(true);
    expect(scanned.some((path) => path.startsWith('scripts/'))).toBe(true);
    expect(scanned.some((path) => path.endsWith('.js') || path.endsWith('.mjs'))).toBe(true);
    expect(scanned.length).toBeGreaterThan(1000);
  });

  it('catches the schema-qualified and quoted spellings of the same read', () => {
    // The first version of this pattern demanded whitespace straight after the
    // keyword and nothing between it and the bare name, so `public.` or a pair
    // of double quotes walked past it.
    for (const bypass of [
      'SELECT * FROM public.fleet_operational_monthly_aggregates',
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

  it('reads the aggregates through the view in the retention coverage gate', () => {
    const retention = readFileSync(
      join(REPO_ROOT, 'src', 'modules', 'fleet', 'incidents', 'retention', 'retentionRepository.ts'), 'utf8',
    );
    expect(retention).toContain(VIEW_NAME);
  });
});
