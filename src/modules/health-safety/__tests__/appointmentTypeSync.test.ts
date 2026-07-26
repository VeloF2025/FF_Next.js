/**
 * H&S appointment-letter type sync ratchet.
 *
 * `hs_appointment_letters.letter_type` is guarded by a DB CHECK constraint
 * (widened in migration 461 to cover the full statutory set found in the
 * 2026-07-26 H&S docs-vs-module alignment audit). The TS `AppointmentLetterType`
 * union and `APPOINTMENT_LETTER_TYPES` array are meant to be a 1:1 mirror of
 * that constraint. Nothing enforces this at compile time -- a value added to
 * one and forgotten in the other either lets the DB reject a value the UI
 * offers, or lets the DB accept a value the UI/types don't know about.
 *
 * This is a static SQL-contract ratchet (mirrors dateTextCast.test.ts): it
 * reads the migration file and the types file as text and asserts the three
 * value lists (DB CHECK, TS union, TS array) are exactly the same set.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/461_hs_appointment_types_widen.sql';
const TYPES_PATH = 'src/modules/health-safety/types/appointment.types.ts';

function readProjectFile(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function dbCheckValues(migrationSrc: string): string[] {
  const match = migrationSrc.match(/CHECK \(letter_type IN \(([\s\S]*?)\)\);/);
  if (!match) throw new Error('Could not find the letter_type CHECK constraint block');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsUnionValues(typesSrc: string): string[] {
  const match = typesSrc.match(/export type AppointmentLetterType =([\s\S]*?);/);
  if (!match) throw new Error('Could not find the AppointmentLetterType union declaration');
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsArrayValues(typesSrc: string): string[] {
  const match = typesSrc.match(/export const APPOINTMENT_LETTER_TYPES[\s\S]*?=\s*\[([\s\S]*)\];/);
  if (!match) throw new Error('Could not find the APPOINTMENT_LETTER_TYPES array declaration');
  return Array.from(match[1].matchAll(/value:\s*'(\w+)'/g)).map((m) => m[1]);
}

describe('hs_appointment_letters.letter_type: DB CHECK <-> TS types stay in sync', () => {
  const migrationSrc = readProjectFile(MIGRATION_PATH);
  const typesSrc = readProjectFile(TYPES_PATH);

  const dbValues = dbCheckValues(migrationSrc);
  const unionValues = tsUnionValues(typesSrc);
  const arrayValues = tsArrayValues(typesSrc);

  it('DB CHECK constraint lists exactly 22 values (4 original + 18 widened)', () => {
    expect(dbValues).toHaveLength(22);
    expect(new Set(dbValues).size).toBe(22); // no accidental duplicates
  });

  it('TS union type matches the DB CHECK constraint exactly', () => {
    expect(new Set(unionValues)).toEqual(new Set(dbValues));
    expect(unionValues).toHaveLength(dbValues.length);
  });

  it('APPOINTMENT_LETTER_TYPES array matches the DB CHECK constraint exactly', () => {
    expect(new Set(arrayValues)).toEqual(new Set(dbValues));
    expect(arrayValues).toHaveLength(dbValues.length);
  });

  it('every DB CHECK value fits the varchar(32) column width', () => {
    const tooLong = dbValues.filter((v) => v.length > 32);
    expect(tooLong).toEqual([]);
  });
});
