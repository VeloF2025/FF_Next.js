import { describe, expect, it } from 'vitest';

import { EXPORT_COLUMNS } from '../../../pages/api/staff/attendance-export';

describe('attendance payroll export columns', () => {
  it('exports only the approved hours-only contract in its exact order', () => {
    expect(Array.from(EXPORT_COLUMNS)).toEqual([
      'staff_id',
      'employee_id',
      'full_name',
      'work_date',
      'ordinary_hours',
      'overtime_hours',
      'sunday_hours',
      'public_holiday_hours',
      'approved_leave_hours',
      'sick_leave_hours',
      'unpaid_hours',
      'project_id',
      'site_id',
      'lock_version',
      'audit_reference',
    ]);
  });

  it('never exposes money, rates, tax, bank or payout fields', () => {
    const columns = EXPORT_COLUMNS.join(',');
    expect(columns).not.toMatch(/wage|rate|salary|tax|bank|pay|amount/i);
  });
});
