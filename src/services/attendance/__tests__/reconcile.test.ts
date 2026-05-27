/**
 * Unit tests for the reconcile orchestrator.
 *
 * The `sql` tagged-template from @/lib/db-pool is mocked. Each test sets up
 * the sequence of query responses the orchestrator will see, then asserts
 * on the aggregated report and the shape of the INSERTs/UPDATEs emitted.
 *
 * We do NOT mock the calculator — it's pure and cheap, and its behaviour is
 * part of what we want to verify end-to-end.
 *
 * Test quality: assertions on SQL text use a regex-based finder over
 * `sqlMock.mock.calls` rather than hard-coded indices. Adding a new
 * precondition query won't silently break a correctness assertion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { reconcile, isoWeekMonday } from '../reconcile';

const DEFAULT_RULE_ROW = {
  id: 'rule-1',
  daily_ordinary_hrs: '9',
  weekly_ordinary_hrs: '45',
  weekly_ot_cap_hrs: '10',
  ot_multiplier: '1.5',
  sunday_multiplier_default: '2',
  sunday_ordinary_multiplier: '1.5',
  holiday_multiplier: '2',
  night_shift_allowance: '0.1',
  night_start: '18:00',
  night_end: '06:00',
};

type MockCall = readonly [readonly string[], ...unknown[]];

function findCalls(pattern: RegExp): MockCall[] {
  return (sqlMock.mock.calls as MockCall[]).filter((call) =>
    pattern.test(call[0].join(' '))
  );
}

function paramsOf(call: MockCall): readonly unknown[] {
  return call.slice(1);
}

function closedEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: overrides.id ?? 'e1',
    staff_id: overrides.staff_id ?? 's1',
    work_date: overrides.work_date ?? '2026-04-20',
    clock_in_at: overrides.clock_in_at ?? '2026-04-20T06:00:00+00:00',
    clock_out_at: overrides.clock_out_at ?? '2026-04-20T14:00:00+00:00',
    bcea_applicable: overrides.bcea_applicable ?? true,
    ordinarily_works_sundays: overrides.ordinarily_works_sundays ?? false,
    hourly_rate: overrides.hourly_rate ?? null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isoWeekMonday
// ---------------------------------------------------------------------------

describe('isoWeekMonday', () => {
  it('Monday maps to itself', () => {
    expect(isoWeekMonday('2026-04-20')).toBe('2026-04-20');
  });
  it('Sunday maps to the PREVIOUS Monday', () => {
    expect(isoWeekMonday('2026-04-19')).toBe('2026-04-13');
  });
  it('Wednesday maps to Monday of same week', () => {
    expect(isoWeekMonday('2026-04-22')).toBe('2026-04-20');
  });
  it('year-end Thursday maps to Monday of that ISO week (2026-12-31 → 2026-12-28)', () => {
    // Regression guard for payroll year-end runs spanning the calendar year.
    expect(isoWeekMonday('2026-12-31')).toBe('2026-12-28');
    // Fri 2027-01-01 shares the ISO week with 2026-12-28
    expect(isoWeekMonday('2027-01-01')).toBe('2026-12-28');
  });
  it('agrees with the lockQueries re-export (consolidated implementation)', async () => {
    // Post-hardening there is ONE implementation in src/services/attendance/
    // isoWeek.ts, re-exported by both reconcile.ts (via this module) AND
    // lockQueries.ts. Import the lockQueries export dynamically to prove
    // identity rather than accidental string equality.
    const { isoWeekMonday: lockVariant } = await import(
      '@/modules/attendance/corrections/lockQueries'
    );
    expect(lockVariant('2026-04-26')).toBe(isoWeekMonday('2026-04-26'));
    expect(lockVariant('2026-12-31')).toBe(isoWeekMonday('2026-12-31'));
  });
  it('throws on malformed YYYY-MM-DD input', () => {
    expect(() => isoWeekMonday('not-a-date')).toThrow(/YYYY-MM-DD/);
  });

  it('accepts a Date object (pg driver returns DATE columns as Date)', () => {
    // Regression guard for the 500 on 2026-04-24 where findOpenEntry
    // returned work_date as a Date, clock-out.ts passed it to
    // isoWeekMonday, and String coercion produced
    // "Fri Apr 24 2026 00:00:00 GMT+0200 ..." which failed the regex.
    // UTC midnight Date == same calendar day as the string form.
    const friday = new Date('2026-04-24T00:00:00Z');
    expect(isoWeekMonday(friday)).toBe('2026-04-20');
  });

  it('throws on a Date that is NaN', () => {
    expect(() => isoWeekMonday(new Date('invalid'))).toThrow(/unparseable/i);
  });
});

// ---------------------------------------------------------------------------
// Auto-close path
// ---------------------------------------------------------------------------

describe('reconcile — auto-close dangling entries', () => {
  beforeEach(() => sqlMock.mockReset());

  it('auto-closes entries older than 16h and raises missing_clock_out with original clock_in_at', async () => {
    sqlMock
      // loadOpenEntriesOlderThan
      .mockResolvedValueOnce([
        {
          id: 'e1',
          staff_id: 's1',
          clock_in_at: '2026-04-19T10:00:00Z',
          work_date: '2026-04-19',
        },
      ])
      // UPDATE ... RETURNING id — returns the updated row
      .mockResolvedValueOnce([{ id: 'e1' }])
      // INSERT exception
      .mockResolvedValueOnce([])
      // loadDefaultRule
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      // holidays
      .mockResolvedValueOnce([])
      // pending
      .mockResolvedValueOnce([]);

    const report = await reconcile({
      fromDate: '2026-04-19',
      toDate: '2026-04-22',
    });
    expect(report.autoClosed).toBe(1);
    expect(report.summariesUpserted).toBe(0);

    const exceptionCalls = findCalls(/INSERT\s+INTO\s+attendance_exceptions/i);
    expect(exceptionCalls).toHaveLength(1);
    const exceptionSql = exceptionCalls[0]![0].join(' ');
    expect(exceptionSql).toMatch(/'missing_clock_out'/);
    expect(exceptionSql).toMatch(/original_clock_in_at/);
    // The clock_in_at param flows through as the third user param
    expect(paramsOf(exceptionCalls[0]!)).toContain('2026-04-19T10:00:00Z');
  });

  it('does NOT raise missing_clock_out when a concurrent user clock-out wins the race', async () => {
    // Regression for P0: UPDATE WHERE status='open' becomes a no-op when
    // the staff clocked out via /my in the race window. We must not insert
    // a phantom `missing_clock_out` exception on a legitimate clock-out.
    sqlMock
      .mockResolvedValueOnce([
        {
          id: 'e1',
          staff_id: 's1',
          clock_in_at: '2026-04-19T10:00:00Z',
          work_date: '2026-04-19',
        },
      ])
      // UPDATE RETURNING id — empty = lost the race
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const report = await reconcile({ fromDate: '2026-04-19', toDate: '2026-04-22' });

    expect(report.autoClosed).toBe(0);
    // Crucially: no exception INSERT happened
    const exceptionCalls = findCalls(/INSERT\s+INTO\s+attendance_exceptions/i);
    expect(exceptionCalls).toHaveLength(0);
  });

  it('per-entry auto-close UPDATE failure is logged but does not abort the run', async () => {
    sqlMock
      .mockResolvedValueOnce([
        { id: 'e1', staff_id: 's1', clock_in_at: '2026-04-19T10:00:00Z', work_date: '2026-04-19' },
        { id: 'e2', staff_id: 's2', clock_in_at: '2026-04-19T11:00:00Z', work_date: '2026-04-19' },
      ])
      // e1 UPDATE succeeds
      .mockResolvedValueOnce([{ id: 'e1' }])
      .mockResolvedValueOnce([]) // e1 exception INSERT
      // e2 UPDATE throws
      .mockRejectedValueOnce(new Error('fk violation'))
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const report = await reconcile({ fromDate: '2026-04-19', toDate: '2026-04-22' });
    expect(report.autoClosed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

describe('reconcile — compute summaries', () => {
  beforeEach(() => sqlMock.mockReset());

  it('upserts a summary for a closed entry missing one (ON CONFLICT DO UPDATE)', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // no auto-close candidates
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([]) // holidays
      .mockResolvedValueOnce([
        closedEntry({
          id: 'e1',
          clock_in_at: '2026-04-20T06:00:00+00:00', // 08:00 SAST
          clock_out_at: '2026-04-20T14:00:00+00:00', // 16:00 SAST = 8h
        }),
      ])
      .mockResolvedValueOnce([{ total: '0' }]) // persisted weekly OT before
      .mockResolvedValueOnce([]); // upsert

    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });
    expect(report.summariesUpserted).toBe(1);
    expect(report.weeklyCapViolations).toBe(0);

    const upsertCalls = findCalls(/INSERT\s+INTO\s+attendance_daily_summaries/i);
    expect(upsertCalls).toHaveLength(1);
    const sqlText = upsertCalls[0]![0].join(' ');
    expect(sqlText).toMatch(/ON\s+CONFLICT\s+\(staff_id,\s*work_date\)\s+DO\s+UPDATE/i);
    // The calculator produced regular=8 for an 8h shift; it should appear
    // as a param on this upsert. Locks down the calculator wiring.
    expect(paramsOf(upsertCalls[0]!)).toContain(8);
    // No hourly_rate provided → wage_amount_cents + snapshot both null.
    expect(paramsOf(upsertCalls[0]!)).toContain(null);
  });

  it('threads wage_amount_cents + hourly_rate_snapshot_cents when staff.hourly_rate is set', async () => {
    // Regression for PR #1406: the wage calculator result + rate snapshot
    // must land on the upsert so downstream payroll can read them. R120/hr
    // × 8h weekday = R960 → 96000 cents; snapshot = 12000 cents/hr.
    sqlMock
      .mockResolvedValueOnce([]) // no auto-close candidates
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([]) // holidays
      .mockResolvedValueOnce([
        closedEntry({
          id: 'e1',
          clock_in_at: '2026-04-20T06:00:00+00:00',
          clock_out_at: '2026-04-20T14:00:00+00:00',
          hourly_rate: '120.00',
        }),
      ])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([]);

    await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });

    const upsertCalls = findCalls(/INSERT\s+INTO\s+attendance_daily_summaries/i);
    expect(upsertCalls).toHaveLength(1);
    const params = paramsOf(upsertCalls[0]!);
    expect(params).toContain(96000); // wage_amount_cents
    expect(params).toContain(12000); // hourly_rate_snapshot_cents
  });

  it('bcea_exempt staff with rate: wage = regularHrs × rate only (no stacking)', async () => {
    // Exempt staff above s6 threshold. An 11h shift: calculator returns
    // regular=11, overtime/sunday/holiday/night=0, computation_mode='bcea_exempt'.
    // Wage at R120/hr = 11 × 12000 = 132000 cents.
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        closedEntry({
          id: 'e1',
          clock_in_at: '2026-04-20T04:00:00+00:00', // 06:00 SAST
          clock_out_at: '2026-04-20T15:00:00+00:00', // 17:00 SAST = 11h
          bcea_applicable: false,
          hourly_rate: '120.00',
        }),
      ])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([]);

    await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });

    const upsertCalls = findCalls(/INSERT\s+INTO\s+attendance_daily_summaries/i);
    const params = paramsOf(upsertCalls[0]!);
    expect(params).toContain(132000); // 11 × 12000 cents, no 1.5x OT stacking
    expect(params).toContain(12000); // rate snapshot
  });

  it('loadPersistedWeeklyOtBefore is called with the first recomputing date (NOT <> ALL exclude-list)', async () => {
    // Regression for the mid-week-backfill P1: seed must use `work_date <
    // firstRecomputeDate`, not `<> ALL(excludeDates)`. Assert the SQL
    // shape + that the parameters include the Monday and the first date
    // being recomputed.
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        closedEntry({ id: 'e1', work_date: '2026-04-22' }), // Wed
      ])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([]);

    await reconcile({ fromDate: '2026-04-22', toDate: '2026-04-22' });

    const seedCalls = findCalls(/SUM\(overtime_hrs\).*FROM\s+attendance_daily_summaries/is);
    expect(seedCalls).toHaveLength(1);
    const seedSql = seedCalls[0]![0].join(' ');
    expect(seedSql).toMatch(/work_date\s*>=/);
    expect(seedSql).toMatch(/work_date\s*<\s/); // strict less-than, not <>
    expect(seedSql).not.toMatch(/<>\s*ALL/);
    const params = paramsOf(seedCalls[0]!);
    expect(params).toContain('2026-04-20'); // week Monday
    expect(params).toContain('2026-04-22'); // first recomputing date
  });

  it('threads weekly OT chronologically — cap fires on the 3rd day, parameterised with entry e3', async () => {
    // Three 11h weekday entries Mon-Wed same week, each 2h OT.
    // Persisted already 6h. 6 + 2 + 2 + 2 = 12 > 10 cap on e3.
    // Feed entries REVERSED in the pending array to catch any
    // "processes-in-mock-order-not-chronological" bug.
    const entries = [
      closedEntry({ id: 'e3', work_date: '2026-04-22', clock_in_at: '2026-04-22T04:00:00+00:00', clock_out_at: '2026-04-22T15:00:00+00:00' }),
      closedEntry({ id: 'e2', work_date: '2026-04-21', clock_in_at: '2026-04-21T04:00:00+00:00', clock_out_at: '2026-04-21T15:00:00+00:00' }),
      closedEntry({ id: 'e1', work_date: '2026-04-20', clock_in_at: '2026-04-20T04:00:00+00:00', clock_out_at: '2026-04-20T15:00:00+00:00' }),
    ];
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce([{ total: '6' }]) // persisted 6h OT before earliest recompute date
      .mockResolvedValueOnce([]) // upsert e1 (sorted chronologically by loader)
      .mockResolvedValueOnce([]) // upsert e2
      .mockResolvedValueOnce([]) // upsert e3
      .mockResolvedValueOnce([]); // cap-violation exception for e3

    // NB: loadClosedEntriesMissingSummary in reconcileQueries.ts orders by
    // (staff_id, work_date, clock_in_at) so even if the mock returns
    // reversed, the orchestrator's inner loop sees them in order. We rely
    // on that ORDER BY here; the separate SQL-shape test below asserts it
    // explicitly.
    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-22' });

    expect(report.summariesUpserted).toBe(3);
    expect(report.weeklyCapViolations).toBe(1);

    const capCalls = findCalls(/INSERT\s+INTO\s+attendance_exceptions/i).filter(
      (c) => c[0].join(' ').includes('weekly_ot_cap_exceeded')
    );
    expect(capCalls).toHaveLength(1);
    // The cap violation must be attributed to e3 (the chronologically last
    // entry), not e1 (first seen in the mock input).
    expect(paramsOf(capCalls[0]!)).toContain('e3');
  });

  it('loadClosedEntriesMissingSummary orders by (staff_id, work_date, clock_in_at)', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });

    const pendingCalls = findCalls(
      /FROM\s+attendance_entries[\s\S]+LEFT\s+JOIN\s+attendance_daily_summaries/i
    );
    expect(pendingCalls).toHaveLength(1);
    const sqlText = pendingCalls[0]![0].join(' ');
    expect(sqlText).toMatch(
      /ORDER\s+BY\s+e\.staff_id\s+ASC,\s+e\.work_date\s+ASC,\s+e\.clock_in_at\s+ASC/i
    );
  });

  it('entries spanning two ISO weeks go into separate (staff, week) groups with their own seed', async () => {
    // Sun 2026-04-19 belongs to ISO week starting 2026-04-13.
    // Mon 2026-04-20 belongs to ISO week starting 2026-04-20.
    const entries = [
      closedEntry({
        id: 'e-prev',
        work_date: '2026-04-19',
        clock_in_at: '2026-04-19T06:00:00+00:00',
        clock_out_at: '2026-04-19T14:00:00+00:00',
      }),
      closedEntry({
        id: 'e-curr',
        work_date: '2026-04-20',
        clock_in_at: '2026-04-20T06:00:00+00:00',
        clock_out_at: '2026-04-20T14:00:00+00:00',
      }),
    ];
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce([{ total: '0' }]) // seed for week-of-2026-04-13
      .mockResolvedValueOnce([]) // upsert e-prev
      .mockResolvedValueOnce([{ total: '0' }]) // seed for week-of-2026-04-20
      .mockResolvedValueOnce([]); // upsert e-curr

    const report = await reconcile({ fromDate: '2026-04-19', toDate: '2026-04-20' });
    expect(report.summariesUpserted).toBe(2);

    const seedCalls = findCalls(/SUM\(overtime_hrs\).*FROM\s+attendance_daily_summaries/is);
    expect(seedCalls).toHaveLength(2);
    const seedParams = seedCalls.flatMap((c) => paramsOf(c));
    // Both week Mondays must appear as params
    expect(seedParams).toContain('2026-04-13');
    expect(seedParams).toContain('2026-04-20');
  });

  it('running OT counter advances after successful upsert even when raiseCapViolation fails', async () => {
    // Regression for P0: previously, the summary was persisted but
    // runningWeeklyOt did NOT advance when raiseCapViolation threw. That
    // left subsequent days in the same week seeing stale counter state
    // and missing their own cap detection. Hardened path advances the
    // counter BEFORE raiseCapViolation.
    const entries = [
      // e1: 11h → 2h OT (persisted=9 → 9+2=11 > 10 cap → violation)
      closedEntry({
        id: 'e1',
        work_date: '2026-04-20',
        clock_in_at: '2026-04-20T04:00:00+00:00',
        clock_out_at: '2026-04-20T15:00:00+00:00',
      }),
      // e2: 11h → 2h OT (new running=11+2=13 > 10 cap → violation)
      closedEntry({
        id: 'e2',
        work_date: '2026-04-21',
        clock_in_at: '2026-04-21T04:00:00+00:00',
        clock_out_at: '2026-04-21T15:00:00+00:00',
      }),
    ];
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(entries)
      .mockResolvedValueOnce([{ total: '9' }]) // seed
      .mockResolvedValueOnce([]) // e1 upsert
      .mockRejectedValueOnce(new Error('audit table locked')) // e1 raiseCapViolation FAILS
      .mockResolvedValueOnce([]) // e2 upsert
      .mockResolvedValueOnce([]); // e2 raiseCapViolation succeeds

    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-21' });

    // Both summaries persisted (the audit failure did not stop the run)
    expect(report.summariesUpserted).toBe(2);
    // e1's cap-violation insert failed → 1 success; the report counts only
    // successful violation inserts, and records the failure under
    // errorsPerEntry.
    expect(report.weeklyCapViolations).toBe(1);
    expect(report.errorsPerEntry.map((e) => e.entryId)).toContain('e1');
    // Crucially, e2's cap violation DID fire — proving runningWeeklyOt
    // advanced even after e1's raiseCapViolation threw. If the counter
    // had gotten stuck at 9 (the seed), 9+2=11 cap check for e2 would
    // still fire; but if the counter never advanced past 9 throughout,
    // the weeklyTotalAfter param passed to raiseCapViolation for e2
    // would be 11, not 13. Assert that.
    const capCalls = findCalls(/weekly_ot_cap_exceeded/).filter((c) =>
      paramsOf(c).includes('e2')
    );
    expect(capCalls).toHaveLength(1);
    expect(paramsOf(capCalls[0]!)).toContain(13);
  });

  it('no-op when no pending entries exist (not to be confused with ON CONFLICT idempotence)', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]); // empty pending
    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });
    expect(report.summariesUpserted).toBe(0);
  });

  it('BCEA-exempt entry still gets a summary row with bcea_exempt mode', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        closedEntry({
          clock_in_at: '2026-04-20T04:00:00+00:00',
          clock_out_at: '2026-04-20T18:00:00+00:00', // 14h
          bcea_applicable: false,
        }),
      ])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([]);

    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' });
    expect(report.summariesUpserted).toBe(1);
    expect(report.weeklyCapViolations).toBe(0);

    const upsertCalls = findCalls(/INSERT\s+INTO\s+attendance_daily_summaries/i);
    expect(paramsOf(upsertCalls[0]!)).toContain('bcea_exempt');
  });

  it('skips entries the calculator returns as incomplete (e.g. >24h shift)', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        closedEntry({
          clock_in_at: '2026-04-20T00:00:00+00:00',
          clock_out_at: '2026-04-21T06:00:00+00:00', // 30h
        }),
      ])
      .mockResolvedValueOnce([{ total: '0' }]);

    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-21' });
    expect(report.summariesUpserted).toBe(0);
    expect(report.summariesSkippedIncomplete).toBe(1);
    // No attendance_daily_summaries insert should have fired
    expect(findCalls(/INSERT\s+INTO\s+attendance_daily_summaries/i)).toHaveLength(0);
  });

  it('per-entry upsert failure is captured in errorsPerEntry, run continues', async () => {
    sqlMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        closedEntry({ id: 'e1', work_date: '2026-04-20' }),
        closedEntry({ id: 'e2', work_date: '2026-04-21' }),
      ])
      .mockResolvedValueOnce([{ total: '0' }]) // seed
      .mockRejectedValueOnce(new Error('check constraint violated')) // e1 upsert fails
      .mockResolvedValueOnce([]); // e2 upsert succeeds

    const report = await reconcile({ fromDate: '2026-04-20', toDate: '2026-04-22' });
    expect(report.summariesUpserted).toBe(1);
    expect(report.errorsPerEntry).toHaveLength(1);
    expect(report.errorsPerEntry[0]?.entryId).toBe('e1');
  });
});

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

describe('reconcile — preconditions', () => {
  beforeEach(() => sqlMock.mockReset());

  it('aborts when no default rule is seeded', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // auto-close none
      .mockResolvedValueOnce([]); // loadDefaultRule returns empty
    await expect(
      reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' })
    ).rejects.toThrow(/no active default attendance_overtime_rules/);
  });

  it('rejects inverted date range', async () => {
    await expect(
      reconcile({ fromDate: '2026-04-30', toDate: '2026-04-01' })
    ).rejects.toThrow(/fromDate.*>\s*toDate/);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('loadPersistedWeeklyOtBefore throws on non-numeric SUM result (propagates up)', async () => {
    sqlMock
      .mockResolvedValueOnce([]) // auto-close
      .mockResolvedValueOnce([DEFAULT_RULE_ROW])
      .mockResolvedValueOnce([]) // holidays
      .mockResolvedValueOnce([closedEntry({ id: 'e1' })])
      .mockResolvedValueOnce([{ total: 'corrupted' }]); // seed returns garbage

    await expect(
      reconcile({ fromDate: '2026-04-20', toDate: '2026-04-20' })
    ).rejects.toThrow(/non-numeric total/);
  });
});
