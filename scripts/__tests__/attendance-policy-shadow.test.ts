import { describe, expect, it, vi } from 'vitest';

import {
  parseShadowArgs,
  runAttendancePolicyShadow,
  serializeShadowRows,
  type ShadowQuery,
} from '../audit/attendance-policy-shadow';

describe('attendance policy shadow audit', () => {
  it('rejects moving or invalid date windows and unsupported formats', () => {
    expect(parseShadowArgs(['--from=2026-08-03', '--to=2026-08-09', '--format=json']))
      .toEqual({ from: '2026-08-03', to: '2026-08-09', format: 'json' });
    expect(() => parseShadowArgs(['--from=today', '--to=2026-08-09', '--format=json'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseShadowArgs(['--from=2026-08-10', '--to=2026-08-09', '--format=csv'])).toThrow(/on or before/);
    expect(() => parseShadowArgs(['--from=2026-08-03', '--to=2026-08-09', '--format=xlsx'])).toThrow(/json or csv/);
  });

  it('starts from the expected universe and emits deterministic coverage, totals, and gate reasons', async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const query: ShadowQuery = vi.fn(async (text, values) => {
      calls.push({ text, values });
      if (text.includes('expected_universe')) return { rows: [
        { staff_id: 'worker-a', work_date: '2026-08-03' },
        { staff_id: 'worker-b', work_date: '2026-08-04' },
        { staff_id: 'worker-c', work_date: '2026-08-05' },
      ] };
      if (text.includes('legacy_projection')) return { rows: [
        { staff_id: 'worker-b', work_date: '2026-08-04', status: null, regular_hours: 8, overtime_hours: 1, sunday_hours: 0, holiday_hours: 0, leave_hours: 0, unpaid_hours: 0, classification: null, blocker_count: 0 },
        { staff_id: 'worker-a', work_date: '2026-08-03', status: null, regular_hours: 8, overtime_hours: 0, sunday_hours: 0, holiday_hours: 0, leave_hours: 0, unpaid_hours: 0, classification: null, blocker_count: 0 },
      ] };
      if (text.includes('policy_projection')) return { rows: [
        { staff_id: 'worker-a', work_date: '2026-08-03', status: 'approved', regular_hours: 7, overtime_hours: 0, sunday_hours: 0, holiday_hours: 2, leave_hours: 0, unpaid_hours: 0, classification: null, blocker_count: 0 },
      ] };
      return { rows: [{ stale_reconciliation: true }] };
    });

    const report = await runAttendancePolicyShadow(query, '2026-08-03', '2026-08-09');

    expect(report.metrics).toEqual({
      expectedDays: 3, legacyObservedDays: 2, policyObservedDays: 1,
      missingBothDays: 1, staleReconciliation: true, deltaDays: 1,
      legacyCategoryTotals: { regularHours: 16, overtimeHours: 1, sundayHours: 0, holidayHours: 0, leaveHours: 0, unpaidHours: 0 },
      policyCategoryTotals: { regularHours: 7, overtimeHours: 0, sundayHours: 0, holidayHours: 2, leaveHours: 0, unpaidHours: 0 },
    });
    expect(report.gate).toEqual({ passed: false, reasonCodes: [
      'STALE_RECONCILIATION', 'MISSING_BOTH_PROJECTIONS',
      'MISSING_LEGACY_PROJECTION', 'MISSING_POLICY_PROJECTION', 'PROJECTION_DELTAS',
    ] });
    expect(report.rows.map((row) => [row.staffId, row.reasonCodes])).toEqual([
      ['worker-a', ['REGULAR_HOURS_DELTA', 'HOLIDAY_HOURS_DELTA']],
      ['worker-b', ['MISSING_POLICY_PROJECTION']],
      ['worker-c', ['MISSING_BOTH_PROJECTIONS']],
    ]);
    expect(calls).toHaveLength(4);
    expect(calls.every(({ text }) => !/\b(insert|update|delete|alter|drop|create)\b/i.test(text))).toBe(true);
    expect(calls.every(({ text }) => !text.includes('attendance_daily_policy_results'))).toBe(true);
    expect(calls.every(({ values }) => JSON.stringify(values) === JSON.stringify(['2026-08-03', '2026-08-09']))).toBe(true);
    expect(calls[0]!.text).toMatch(/join_date[\s\S]*end_date[\s\S]*account_status/i);
    expect(calls[3]!.text).toMatch(/ORDER BY started_at DESC LIMIT 1/i);
    expect(calls[3]!.text).toMatch(/MAX\(ds\.computed_at\)/i);
    expect(calls[3]!.text).toMatch(/MAX\(ae\.updated_at\)/i);
    expect(calls[3]!.text).toMatch(/MAX\(aa\.updated_at\)/i);
    expect(calls[3]!.text).toMatch(/MAX\(de\.updated_at\)/i);
    expect(calls[3]!.text).toMatch(/finished_at\s*>=\s*latest_change\.changed_at/i);
  });

  it('compares observed Sunday projections without making Sunday an expected absence day', async () => {
    const projection = (sundayHours: number) => ({
      staff_id: 'worker-a', work_date: '2026-08-09', status: 'approved',
      regular_hours: 0, overtime_hours: 0, sunday_hours: sundayHours,
      holiday_hours: 0, leave_hours: 0, unpaid_hours: 0,
      classification: null, blocker_count: 0,
    });
    const weekday = {
      staff_id: 'worker-a', work_date: '2026-08-03', status: 'approved',
      regular_hours: 8, overtime_hours: 0, sunday_hours: 0,
      holiday_hours: 0, leave_hours: 0, unpaid_hours: 0,
      classification: null, blocker_count: 0,
    };
    const outsideEmployment = {
      ...weekday, staff_id: 'worker-ended', work_date: '2026-08-09', regular_hours: 9,
    };
    const query: ShadowQuery = vi.fn(async (text) => {
      if (text.includes('expected_universe')) return { rows: [
        { staff_id: 'worker-a', work_date: '2026-08-03' },
      ] };
      const employmentScoped = /JOIN\s+staff\s+s_observed[\s\S]*s_observed\.join_date::date\s*<=\s*ds\.work_date[\s\S]*s_observed\.end_date::date\s*>=\s*ds\.work_date/i
        .test(text);
      if (text.includes('legacy_projection')) return {
        rows: [weekday, projection(5), ...(employmentScoped ? [] : [outsideEmployment])],
      };
      if (text.includes('policy_projection')) return {
        rows: [weekday, projection(4), ...(employmentScoped ? [] : [outsideEmployment])],
      };
      return { rows: [{ stale_reconciliation: false }] };
    });

    const report = await runAttendancePolicyShadow(query, '2026-08-03', '2026-08-09');

    expect(report.metrics).toMatchObject({
      expectedDays: 1, legacyObservedDays: 2, policyObservedDays: 2,
      missingBothDays: 0, deltaDays: 1,
      legacyCategoryTotals: expect.objectContaining({ sundayHours: 5 }),
      policyCategoryTotals: expect.objectContaining({ sundayHours: 4 }),
    });
    expect(report.rows).toEqual([expect.objectContaining({
      staffId: 'worker-a', workDate: '2026-08-09', reasonCodes: ['SUNDAY_HOURS_DELTA'],
    })]);
    expect(report.gate).toEqual({ passed: false, reasonCodes: ['PROJECTION_DELTAS'] });
  });

  it('serializes stable JSON and CSV without money or payroll rates', () => {
    const report = { metrics: { expectedDays: 1, legacyObservedDays: 1, policyObservedDays: 1,
      missingBothDays: 0, staleReconciliation: false, deltaDays: 1,
      legacyCategoryTotals: { regularHours: 8, overtimeHours: 0, sundayHours: 0, holidayHours: 0, leaveHours: 0, unpaidHours: 0 },
      policyCategoryTotals: { regularHours: 7, overtimeHours: 0, sundayHours: 0, holidayHours: 0, leaveHours: 0, unpaidHours: 0 } },
      gate: { passed: false, reasonCodes: ['PROJECTION_DELTAS'] },
      rows: [{ staffId: 'worker-a', workDate: '2026-08-03', reasonCodes: ['REGULAR_HOURS_DELTA'],
        legacy: { status: null, regularHours: 8, overtimeHours: 0, sundayHours: 0, holidayHours: 0, leaveHours: 0, unpaidHours: 0, classification: null, blockerCount: 0 },
        policy: { status: 'approved', regularHours: 7, overtimeHours: 0, sundayHours: 0, holidayHours: 0, leaveHours: 0, unpaidHours: 0, classification: null, blockerCount: 0 } }] };
    expect(serializeShadowRows(report, 'json')).toBe(`${JSON.stringify(report, null, 2)}\n`);
    const csv = serializeShadowRows(report, 'csv');
    expect(csv).toContain('summary,expected_days,1');
    expect(csv).toContain('detail,staff_id,work_date,reason_codes,legacy_status,policy_status');
    expect(csv).not.toMatch(/money|rate|wage/i);
  });
});
