/**
 * H&S date-display TZ ratchet.
 *
 * Pure Postgres `date` columns, when read by node-postgres, are parsed into a
 * local-timezone `Date`. On the SAST server (UTC+2) a stored `2026-05-01` then
 * JSON-serializes to `"2026-04-30T22:00:00.000Z"` — i.e. it renders one day
 * early. The fix is display-only: cast each pure `date` column to `::text` in
 * the endpoint's SELECT / RETURNING so it serializes as a plain `YYYY-MM-DD`
 * string (last-column-wins over any `tbl.*` copy). The SQL date arithmetic and
 * overdue/expiry classification are intentionally left on the raw date column
 * and are NOT part of this contract.
 *
 * This is a static SQL-contract ratchet (mirrors rbacGates.test.ts): it fails
 * if any of these casts is dropped, which would silently reintroduce the
 * off-by-one display bug.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// (endpoint file, pure `date` columns it must serialize as text). man-hours is
// deliberately absent: hs_man_hours has no pure `date` column (period_year /
// period_month are integers), so it needs no cast.
//
// SCOPE: this ratchet originally covered the worker-facing H&S record tables
// only. It now also covers the contractor-compliance surface
// (hs_contractor_documents.issue_date/expiry_date, also pure `date`) — see
// CONTRACTS and DISPLAY_ALIAS_CONTRACTS below for the display-vs-compare split
// that surface requires.
const CONTRACTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pages/api/health-safety/training/records/index.ts', ['completed_date', 'expiry_date']],
  ['pages/api/health-safety/training/records/[recordId].ts', ['completed_date', 'expiry_date']],
  ['pages/api/health-safety/training/competency.ts', ['completed_date', 'expiry_date']],
  ['pages/api/health-safety/toolbox/index.ts', ['talk_date']],
  ['pages/api/health-safety/toolbox/[talkId].ts', ['talk_date']],
  ['pages/api/health-safety/ppe/issuance/index.ts', ['issued_date', 'replacement_due']],
  ['pages/api/health-safety/ppe/issuance/[issuanceId].ts', ['issued_date', 'replacement_due']],
  ['pages/api/health-safety/appointments/index.ts', ['appointment_date', 'effective_from']],
  ['pages/api/health-safety/appointments/[letterId].ts', ['appointment_date', 'effective_from']],
  ['pages/api/health-safety/injuries/index.ts', ['injury_date']],
  ['pages/api/health-safety/project/[projectId]/safety-file.ts', ['appointment_date', 'effective_from']],

  // Contractor documents: unlike the tables above, hs_contractor_documents
  // rows also feed JS gate-check comparisons (new Date(d.expiry_date) > new
  // Date()) elsewhere in these same files. `issue_date` never feeds a compare
  // anywhere in this surface, so it's always safe to same-name-cast. `expiry_date`
  // is same-name-cast ONLY in paths that are purely display (POST create's
  // RETURNING, GET single document, PUT's UPDATE...RETURNING) — the paths where
  // the raw `expiry_date` also feeds a gate compare use a *differently-named*
  // `expiry_date_display` alias instead (see DISPLAY_ALIAS_CONTRACTS below). A
  // same-name cast on a compare-feeding column would silently turn a timestamp
  // compare into a date-only compare and is exactly the regression this ratchet
  // exists to catch.
  ['pages/api/health-safety/contractor/[contractorId]/documents.ts', ['issue_date', 'expiry_date']],
  ['pages/api/health-safety/contractor/documents/[documentId].ts', ['issue_date', 'expiry_date']],
];

// Columns cast to text under a DIFFERENT name (`<col>_display`) because the
// same query's raw `<col>` value is also consumed by a JS gate/classification
// compare later in the same handler. Display code must read `<col>_display`,
// not `<col>`, for these endpoints — the raw `<col>` stays a Date object so the
// gate compare is byte-for-byte unchanged from before this fix.
const DISPLAY_ALIAS_CONTRACTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['pages/api/health-safety/contractor/[contractorId]/compliance.ts', ['expiry_date']],
  ['pages/api/health-safety/contractor/[contractorId]/documents.ts', ['expiry_date']],
  ['pages/api/health-safety/contractor/[contractorId]/gate-check.ts', ['expiry_date']],
];

// Matches `<col>::text AS <col>` allowing an optional table alias qualifier
// (e.g. `wt.expiry_date::text AS expiry_date`) and any whitespace around AS.
function castRegex(col: string): RegExp {
  return new RegExp(`(?:\\w+\\.)?${col}::text\\s+AS\\s+${col}\\b`, 'i');
}

// Matches `<col>::text AS <col>_display` (the split-alias variant).
function displayAliasRegex(col: string): RegExp {
  return new RegExp(`(?:\\w+\\.)?${col}::text\\s+AS\\s+${col}_display\\b`, 'i');
}

describe('H&S pure-date columns are cast to text for display', () => {
  for (const [rel, cols] of CONTRACTS) {
    it(`${rel} casts ${cols.join(', ')} to ::text`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      const missing = cols.filter((c) => !castRegex(c).test(src));
      expect(missing).toEqual([]);
    });
  }

  for (const [rel, cols] of DISPLAY_ALIAS_CONTRACTS) {
    it(`${rel} casts ${cols.join(', ')} to a _display alias (gate compare stays on the raw column)`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      const missing = cols.filter((c) => !displayAliasRegex(c).test(src));
      expect(missing).toEqual([]);
    });
  }
});

describe('date-display shape invariant (why the cast is needed)', () => {
  it('a plain YYYY-MM-DD string survives JSON serialization unchanged', () => {
    // This is the shape the ::text cast produces — no time part, so no TZ shift.
    const fromTextCast = '2026-05-01';
    const round = JSON.parse(JSON.stringify({ expiry_date: fromTextCast })).expiry_date;
    expect(round).toBe('2026-05-01');
    expect(round).not.toContain('T');
    expect(round).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a Date object (an uncast date column) serializes with a time part — the failure mode', () => {
    // node-pg hands an uncast `date` column back as a Date; JSON.stringify turns
    // it into a full ISO instant (always containing "T"), which is where the
    // day can slip depending on the server timezone. Deterministic regardless
    // of the runner's TZ: an ISO instant always carries the time component.
    const asDateColumn = new Date('2026-05-01');
    const serialized = JSON.parse(JSON.stringify({ expiry_date: asDateColumn })).expiry_date;
    expect(serialized).toContain('T');
    expect(serialized).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
