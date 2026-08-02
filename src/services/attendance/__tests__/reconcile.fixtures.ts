export const STAFF_ID = '10000000-0000-4000-8000-000000000001';
export const ENTRY_ID = '20000000-0000-4000-8000-000000000001';
export const POLICY = {
  id: '30000000-0000-4000-8000-000000000001',
  timezone: 'Africa/Johannesburg' as const,
  weekdayStart: '08:00' as const,
  weekdayEnd: '17:00' as const,
  weekdayUnpaidBreakMinutes: 60 as const,
  weekdayPaidCapHours: 8 as const,
  saturdayStart: '08:00' as const,
  saturdayEnd: '13:00' as const,
  saturdayPaidCapHours: 5 as const,
  sundayScheduled: false as const,
  sundayMissingOutCapHours: 5 as const,
  lateAlertMinutes: 15 as const,
};
export const RULE = {
  id: '40000000-0000-4000-8000-000000000001',
  dailyOrdinaryHrs: 9,
  weeklyOrdinaryHrs: 45,
  weeklyOtCapHrs: 10,
  otMultiplier: 1.5,
  sundayMultiplierDefault: 2,
  sundayOrdinaryMultiplier: 1.5,
  holidayMultiplier: 2,
  nightShiftAllowance: 0.1,
  nightStart: '18:00',
  nightEnd: '06:00',
};

export function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    staff_id: STAFF_ID,
    work_date: '2026-08-03',
    clock_in_at: '2026-08-03T06:00:00.000Z',
    clock_out_at: null,
    status: 'auto_closed',
    bcea_applicable: true,
    ordinarily_works_sundays: false,
    hourly_rate: null,
    calculation_fingerprint: null,
    result_version: null,
    ...overrides,
  };
}

export function expectedDay(workDate = '2026-08-03') {
  return {
    staff_id: STAFF_ID,
    work_date: workDate,
    is_public_holiday: false,
    public_holiday_name: null,
    calculation_fingerprint: null,
    result_version: null,
  };
}
