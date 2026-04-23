/**
 * Column-order regression test for the weekly payroll export.
 *
 * Payroll vendor importers (Sage, VIP, whatever we plug in under the
 * future Phase 1d adapter) depend on the exact CSV/XLSX header order.
 * A reorder in EXPORT_COLUMNS silently misaligns imports until someone
 * eyeballs a payslip. This test locks the order down.
 *
 * Only import-safe piece — we don't exercise the handler (needs a real
 * DB + auth + user context). The column contract is the load-bearing
 * thing here.
 */

import { describe, it, expect } from 'vitest';
import { EXPORT_COLUMNS } from '../../../pages/api/staff/attendance-export';

describe('attendance-export EXPORT_COLUMNS', () => {
  it('maintains the exact column sequence payroll importers depend on', () => {
    expect(Array.from(EXPORT_COLUMNS)).toEqual([
      'staff_id',
      'employee_id',
      'full_name',
      'work_date',
      'clock_in_at',
      'clock_out_at',
      'regular_hrs',
      'overtime_hrs',
      'sunday_hrs',
      'holiday_hrs',
      'night_hrs',
      'wage_amount',
      'hourly_rate',
      'exceptions_count',
    ]);
  });

  it('places hourly_rate directly after wage_amount (reviewer reads left-to-right)', () => {
    const wageIdx = EXPORT_COLUMNS.indexOf('wage_amount');
    const rateIdx = EXPORT_COLUMNS.indexOf('hourly_rate');
    expect(wageIdx).toBeGreaterThan(-1);
    expect(rateIdx).toBe(wageIdx + 1);
  });

  it('places exceptions_count last (tail of row, payroll-vendor convention)', () => {
    expect(EXPORT_COLUMNS[EXPORT_COLUMNS.length - 1]).toBe('exceptions_count');
  });
});
