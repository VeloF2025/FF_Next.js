/**
 * H&S safety-library content-type sync ratchet.
 *
 * `hs_safety_library.content_type` is guarded by a DB CHECK constraint
 * (migration 464). The TS `SafetyLibraryContentType` union and the
 * `SAFETY_LIBRARY_TYPES` config record are meant to be a 1:1 mirror of it.
 * Nothing enforces that at compile time — a value added to one and forgotten in
 * the other either lets the DB reject a type the UI offers, or lets the DB
 * accept one the API cannot classify (and `SAFETY_LIBRARY_TYPES[ct]` would then
 * be undefined, turning the msds-only chemical-field guard into a crash).
 *
 * Also pins the msds-only invariant itself: the whole justification for one
 * table with a discriminator instead of two tables is that the chemical
 * columns cannot leak onto a procedure row.
 *
 * Static SQL-contract ratchet, mirroring appointmentTypeSync.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/464_hs_safety_library.sql';
const TYPES_PATH = 'src/modules/health-safety/types/library.types.ts';

function readProjectFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function dbCheckValues(migrationSrc: string): string[] {
  const match = migrationSrc.match(/CHECK \(content_type IN \(([\s\S]*?)\)\)/);
  if (!match) throw new Error('Could not find the content_type CHECK constraint block');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsUnionValues(typesSrc: string): string[] {
  const match = typesSrc.match(/export type SafetyLibraryContentType =([\s\S]*?);/);
  if (!match) throw new Error('Could not find the SafetyLibraryContentType union declaration');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsConfigValues(typesSrc: string): string[] {
  // Non-greedy `[\s\S]*?` stops at the FIRST `\n};` after the opening brace —
  // this record's own close, not the last one in the file.
  const match = typesSrc.match(/export const SAFETY_LIBRARY_TYPES[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!match) throw new Error('Could not find the SAFETY_LIBRARY_TYPES record declaration');
  return Array.from(match[1].matchAll(/value:\s*'(\w+)'/g)).map((m) => m[1]);
}

describe('hs_safety_library.content_type: DB CHECK <-> TS types stay in sync', () => {
  const migrationSrc = readProjectFile(MIGRATION_PATH);
  const typesSrc = readProjectFile(TYPES_PATH);

  const dbValues = dbCheckValues(migrationSrc);
  const unionValues = tsUnionValues(typesSrc);
  const configValues = tsConfigValues(typesSrc);

  it('DB CHECK constraint lists exactly the 4 content types', () => {
    expect(dbValues).toEqual(['msds', 'swp', 'method_statement', 'jsa']);
    expect(new Set(dbValues).size).toBe(4); // no accidental duplicates
  });

  it('TS union type matches the DB CHECK constraint exactly', () => {
    expect(new Set(unionValues)).toEqual(new Set(dbValues));
    expect(unionValues).toHaveLength(dbValues.length);
  });

  it('SAFETY_LIBRARY_TYPES config matches the DB CHECK constraint exactly', () => {
    expect(new Set(configValues)).toEqual(new Set(dbValues));
    expect(configValues).toHaveLength(dbValues.length);
  });

  it('every DB CHECK value fits the varchar(24) column width', () => {
    const tooLong = dbValues.filter((v) => v.length > 24);
    expect(tooLong).toEqual([]);
  });

  it('exactly one content type carries the chemical fields, and it is msds', () => {
    const chemical = Array.from(
      typesSrc.matchAll(/value:\s*'(\w+)',[\s\S]*?has_chemical_fields:\s*(true|false)/g)
    )
      .filter((m) => m[2] === 'true')
      .map((m) => m[1]);
    expect(chemical).toEqual(['msds']);
  });

  it('the migration confines the chemical columns to msds rows', () => {
    expect(migrationSrc).toMatch(
      /CHECK \(\s*content_type = 'msds'\s*OR \(supplier IS NULL AND ghs_hazard_class IS NULL AND storage_location IS NULL\)\s*\)/
    );
  });
});
