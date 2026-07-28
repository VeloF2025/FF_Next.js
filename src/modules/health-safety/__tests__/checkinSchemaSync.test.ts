/**
 * hs_daily_checkins: DB CHECK constraints <-> TS types ratchet.
 *
 * Mirrors appointmentTypeSync / medicalOutcomeSync / safetyLibraryTypeSync.
 * Beyond the usual vocabulary sync, this also pins the three constraints that
 * carry the design decisions, because each encodes a rule that would otherwise
 * live only in a handler:
 *
 *   unfit_not_cleared        — the teeth. An unfit worker is never 'cleared'.
 *   crew_requires_contractor — a crew row without a contractor never reaches
 *                              the gate it exists to feed (the #2269 defect).
 *   self_requires_staff      — a self-declaration is always by a known user.
 *
 * A handler bug can be fixed; a row already written in a bad state cannot, so
 * these belong in the database and are asserted here so nobody quietly removes
 * one while "simplifying" the migration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = 'scripts/migrations/sql/465_hs_daily_checkins.sql';
const TYPES_PATH = 'src/modules/health-safety/types/checkin.types.ts';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function dbCheckValues(src: string, column: string): string[] {
  const match = src.match(new RegExp(`CHECK \\(${column} IN \\(([\\s\\S]*?)\\)\\)`));
  if (!match) throw new Error(`Could not find the ${column} CHECK constraint`);
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

function tsUnion(src: string, name: string): string[] {
  const match = src.match(new RegExp(`export type ${name} =([\\s\\S]*?);`));
  if (!match) throw new Error(`Could not find the ${name} union`);
  return Array.from(match[1].matchAll(/'(\w+)'/g)).map((m) => m[1]);
}

describe('hs_daily_checkins vocabularies stay in sync with the TS types', () => {
  const migration = read(MIGRATION_PATH);
  const types = read(TYPES_PATH);

  it('capture_mode matches CheckinCaptureMode', () => {
    const db = dbCheckValues(migration, 'capture_mode');
    expect(db).toEqual(['self', 'crew_lead']);
    expect(new Set(tsUnion(types, 'CheckinCaptureMode'))).toEqual(new Set(db));
  });

  it('clearance matches CheckinClearance', () => {
    const db = dbCheckValues(migration, 'clearance');
    expect(db).toEqual(['cleared', 'blocked', 'cleared_by_override']);
    expect(new Set(tsUnion(types, 'CheckinClearance'))).toEqual(new Set(db));
  });

  it('every vocabulary value fits its varchar column width', () => {
    expect(dbCheckValues(migration, 'capture_mode').filter((v) => v.length > 16)).toEqual([]);
    expect(dbCheckValues(migration, 'clearance').filter((v) => v.length > 20)).toEqual([]);
  });
});

describe('counts describe what their names claim', () => {
  it('the contractor rollup counts DISTINCT hazard submissions, not rows', () => {
    // One hazard reported by a crew lead is stamped on every crew member's row.
    // COUNT(*) would report a single trench as three hazards.
    const svc = read('src/modules/health-safety/services/checkinService.ts');
    expect(svc).toMatch(/COUNT\(DISTINCT submission_id\) FILTER \(\s*\n\s*WHERE hazard_reported/);
    expect(svc).not.toMatch(/COUNT\(\*\) FILTER \(\s*\n\s*WHERE hazard_reported/);
  });

  it('the board de-duplicates hazards and names the PPE stat for what it counts', () => {
    const board = read('pages/api/health-safety/checkins/index.ts');
    expect(board).toMatch(/hazards: new Set\(/);
    // "ppe_gaps" would read as a count of gaps; it is a count of workers.
    expect(board).toMatch(/workers_with_ppe_gap:/);
  });
});

describe('the design decisions are enforced by the database, not just the handlers', () => {
  const migration = read(MIGRATION_PATH);

  it('an unfit worker can never be stored as cleared', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_unfit_not_cleared\s+CHECK \(fit_for_duty OR clearance <> 'cleared'\)/
    );
  });

  it('a crew row must carry the contractor it is evidence for', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_crew_requires_contractor\s+CHECK \(capture_mode <> 'crew_lead' OR contractor_id IS NOT NULL\)/
    );
  });

  it('a self-declaration must come from a known staff member', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_self_requires_staff\s+CHECK \(capture_mode <> 'self' OR staff_id IS NOT NULL\)/
    );
  });

  it('an override must name who made it', () => {
    expect(migration).toMatch(
      /CONSTRAINT hs_daily_checkins_override_needs_clearer\s+CHECK \(clearance <> 'cleared_by_override' OR cleared_by IS NOT NULL\)/
    );
  });

  it('one self check-in per person per day', () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?hs_daily_checkins_one_self_per_day[\s\S]*?\(staff_id, checkin_date\)[\s\S]*?WHERE capture_mode = 'self'/
    );
  });

  it('checkin_date is supplied by the app, never defaulted to a UTC CURRENT_DATE', () => {
    // A UTC default would bucket early-morning SAST check-ins to the previous
    // day, silently splitting a shift across two dates.
    expect(migration).toMatch(/checkin_date\s+date NOT NULL,/);
    expect(migration).not.toMatch(/checkin_date[^,]*DEFAULT\s+CURRENT_DATE/);
  });
});
