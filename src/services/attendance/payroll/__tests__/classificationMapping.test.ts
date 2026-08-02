import { describe, expect, it } from 'vitest';

import { mapLockedPayrollRows } from '../serialize';
import { daily } from './payrollFake';

function mapped(overrides: Parameters<typeof daily>[0]) {
  return mapLockedPayrollRows([daily(overrides)], 3)[0]!;
}

describe('non-overlapping payroll classification mapping', () => {
  it.each([
    ['worked ordinary', {}, { ordinary_hours: '8.00' }],
    ['worked Sunday', { approved_regular_hrs: '0', approved_sunday_hrs: '5' }, { sunday_hours: '5.00' }],
    ['worked holiday', { approved_regular_hrs: '0', approved_holiday_hrs: '5' }, { public_holiday_hours: '5.00' }],
    ['approved leave', { approved_regular_hrs: '0', leave_hrs: '8', attendance_classification: 'approved_leave' }, { approved_leave_hours: '8.00' }],
    ['sick leave', { approved_regular_hrs: '0', leave_hrs: '8', attendance_classification: 'sick_leave' }, { sick_leave_hours: '8.00' }],
    ['site shutdown', { attendance_classification: 'site_shutdown_weather' }, { ordinary_hours: '8.00' }],
    ['public holiday absence', { approved_regular_hrs: '0', approved_holiday_hrs: '8',
      attendance_classification: 'public_holiday' }, { public_holiday_hours: '8.00' }],
    ['unauthorised absence', { approved_regular_hrs: '0', unpaid_hrs: '8', attendance_classification: 'unauthorised_absence' }, { unpaid_hours: '8.00' }],
  ] as const)('maps %s without overlap', (_label, input, expected) => {
    const row = mapped(input);
    expect(row).toMatchObject(expected);
    const exported = ['ordinary_hours', 'overtime_hours', 'sunday_hours', 'public_holiday_hours',
      'approved_leave_hours', 'sick_leave_hours', 'unpaid_hours'] as const;
    expect(exported.filter((key) => row[key] !== '0.00')).toHaveLength(1);
  });

  it('keeps approved ordinary and overtime as distinct non-overlapping worked hours', () => {
    expect(mapped({ approved_regular_hrs: '8', approved_overtime_hrs: '1.5' })).toMatchObject({
      ordinary_hours: '8.00', overtime_hours: '1.50', sunday_hours: '0.00',
      public_holiday_hours: '0.00', approved_leave_hours: '0.00',
      sick_leave_hours: '0.00', unpaid_hours: '0.00',
    });
  });

  it.each([
    ['ordinary plus Sunday', { approved_sunday_hrs: '5' }],
    ['ordinary plus holiday', { approved_holiday_hrs: '5' }],
    ['Sunday plus holiday', { approved_regular_hrs: '0', approved_sunday_hrs: '5', approved_holiday_hrs: '5' }],
    ['classified leave plus ordinary', { leave_hrs: '8', attendance_classification: 'approved_leave' }],
    ['sick leave plus unpaid', { approved_regular_hrs: '0', leave_hrs: '8', unpaid_hrs: '1', attendance_classification: 'sick_leave' }],
    ['shutdown plus overtime', { approved_overtime_hrs: '1', attendance_classification: 'site_shutdown_weather' }],
    ['holiday classification with ordinary bucket', { attendance_classification: 'public_holiday' }],
    ['holiday classification with two buckets', { approved_holiday_hrs: '5', attendance_classification: 'public_holiday' }],
    ['unauthorised plus ordinary', { unpaid_hrs: '8', attendance_classification: 'unauthorised_absence' }],
  ] as const)('rejects contradictory %s buckets', (_label, input) => {
    expect(() => mapped(input)).toThrowError(expect.objectContaining({ code: 'invalid_locked_results' }));
  });
});
