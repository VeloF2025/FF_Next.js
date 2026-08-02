import type { AttendanceSchedulePolicy } from './types';

export const VELOCITY_FIXED_POLICY: AttendanceSchedulePolicy = {
  id: 'velocity-fixed-schedule-v1',
  timezone: 'Africa/Johannesburg',
  weekdayStart: '08:00',
  weekdayEnd: '17:00',
  weekdayUnpaidBreakMinutes: 60,
  weekdayPaidCapHours: 8,
  saturdayStart: '08:00',
  saturdayEnd: '13:00',
  saturdayPaidCapHours: 5,
  sundayScheduled: false,
  sundayMissingOutCapHours: 5,
  lateAlertMinutes: 15,
};
