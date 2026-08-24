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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const forward = readFileSync(MIGRATION, 'utf8');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) { found.push(...sourceFiles(full)); continue; }
    if (/\.(ts|tsx)$/.test(entry)) found.push(full);
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
    // Matches the table in a SQL position, not in prose — several modules name
    // it in a doc comment to explain what may not reach it, and flagging those
    // would train the next person to delete the explanation rather than the
    // query. The trailing \b keeps the view (…_published) out: `_` is a word
    // character, so no boundary falls between the name and the suffix.
    const pattern = new RegExp(`(FROM|JOIN|INTO|UPDATE)\\s+${BASE_TABLE}\\b`, 'i');
    const offenders: string[] = [];
    for (const file of sourceFiles(join(REPO_ROOT, 'src', 'modules', 'fleet'))) {
      const relativePath = relative(REPO_ROOT, file).split('\\').join('/');
      if (WRITER_FILES.includes(relativePath)) continue;
      if (relativePath.includes('__tests__')) continue;
      if (pattern.test(readFileSync(file, 'utf8'))) offenders.push(relativePath);
    }
    expect(offenders).toEqual([]);
  });

  it('reads the aggregates through the view in the retention coverage gate', () => {
    const retention = readFileSync(
      join(REPO_ROOT, 'src', 'modules', 'fleet', 'incidents', 'retention', 'retentionRepository.ts'), 'utf8',
    );
    expect(retention).toContain(VIEW_NAME);
  });
});
