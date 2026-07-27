/**
 * H&S medical-outcome sync ratchet.
 *
 * `hs_worker_medicals.outcome` is guarded by a DB CHECK constraint (migration
 * 463). The TS `MedicalOutcome` union and the `MEDICAL_OUTCOMES` config record
 * are meant to be a 1:1 mirror of it. Nothing enforces that at compile time — a
 * value added to one and forgotten in the other either lets the DB reject a
 * verdict the UI offers, or lets the DB accept one the gate does not know how
 * to score (which would silently fail OPEN: an unrecognised verdict would not
 * block the contractor gate).
 *
 * This is a static SQL-contract ratchet (mirrors appointmentTypeSync.test.ts):
 * it reads the migration and the types file as text and asserts the three value
 * lists are exactly the same set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/463_hs_worker_medicals.sql';
const TYPES_PATH = 'src/modules/health-safety/types/medical.types.ts';

function readProjectFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function dbCheckValues(migrationSrc: string): string[] {
  const match = migrationSrc.match(/CHECK \(outcome IN \(([\s\S]*?)\)\)/);
  if (!match) throw new Error('Could not find the outcome CHECK constraint block');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsUnionValues(typesSrc: string): string[] {
  const match = typesSrc.match(/export type MedicalOutcome =([\s\S]*?);/);
  if (!match) throw new Error('Could not find the MedicalOutcome union declaration');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsConfigValues(typesSrc: string): string[] {
  // Non-greedy `[\s\S]*?` stops at the FIRST `};` after the opening brace — its
  // own close. A greedy match would run to the last one in the file.
  const match = typesSrc.match(/export const MEDICAL_OUTCOMES[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!match) throw new Error('Could not find the MEDICAL_OUTCOMES record declaration');
  return Array.from(match[1].matchAll(/value:\s*'(\w+)'/g)).map((m) => m[1]);
}

describe('hs_worker_medicals.outcome: DB CHECK <-> TS types stay in sync', () => {
  const migrationSrc = readProjectFile(MIGRATION_PATH);
  const typesSrc = readProjectFile(TYPES_PATH);

  const dbValues = dbCheckValues(migrationSrc);
  const unionValues = tsUnionValues(typesSrc);
  const configValues = tsConfigValues(typesSrc);

  it('DB CHECK constraint lists exactly the 3 medical verdicts', () => {
    expect(dbValues).toEqual(['fit', 'fit_with_restriction', 'unfit']);
    expect(new Set(dbValues).size).toBe(3); // no accidental duplicates
  });

  it('TS union type matches the DB CHECK constraint exactly', () => {
    expect(new Set(unionValues)).toEqual(new Set(dbValues));
    expect(unionValues).toHaveLength(dbValues.length);
  });

  it('MEDICAL_OUTCOMES config matches the DB CHECK constraint exactly', () => {
    expect(new Set(configValues)).toEqual(new Set(dbValues));
    expect(configValues).toHaveLength(dbValues.length);
  });

  it('every DB CHECK value fits the varchar(24) column width', () => {
    const tooLong = dbValues.filter((v) => v.length > 24);
    expect(tooLong).toEqual([]);
  });

  it('the migration keeps the fit_with_restriction invariant (restriction must be stated)', () => {
    expect(migrationSrc).toMatch(
      /CHECK \(outcome <> 'fit_with_restriction' OR btrim\(coalesce\(restrictions, ''\)\) <> ''\)/
    );
  });
});
