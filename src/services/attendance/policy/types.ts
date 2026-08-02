export type DailyResultStatus =
  | 'expected'
  | 'open'
  | 'complete'
  | 'provisional'
  | 'awaiting_worker'
  | 'awaiting_supervisor'
  | 'approved'
  | 'locked'
  | 'absence_review';

export type DayExceptionKind =
  | 'missing_clock_in'
  | 'missing_clock_out'
  | 'late_arrival'
  | 'early_departure'
  | 'outside_schedule'
  | 'sunday_work'
  | 'public_holiday_work'
  | 'evidence_unreliable';

export type AttendanceClassification =
  | 'approved_leave'
  | 'sick_leave'
  | 'site_shutdown_weather'
  | 'public_holiday'
  | 'unauthorised_absence';

export interface AttendanceSchedulePolicy {
  id: string;
  timezone: 'Africa/Johannesburg';
  weekdayStart: '08:00';
  weekdayEnd: '17:00';
  weekdayUnpaidBreakMinutes: 60;
  weekdayPaidCapHours: 8;
  saturdayStart: '08:00';
  saturdayEnd: '13:00';
  saturdayPaidCapHours: 5;
  sundayScheduled: false;
  sundayMissingOutCapHours: 5;
  lateAlertMinutes: 15;
}

export interface ClockEvidence {
  workDate: string;
  clockInAt: Date | null;
  clockOutAt: Date | null;
  clockOutSource: 'device' | 'system' | 'manual' | null;
}

export interface ApprovedLeave {
  classification: 'approved_leave' | 'sick_leave';
  hours: number;
}

export interface CalculateDailyResultInput {
  policy: AttendanceSchedulePolicy;
  evidence: ClockEvidence;
  isPublicHoliday: boolean;
  approvedLeave?: ApprovedLeave | null;
}

export interface CalculatedDailyResult {
  workDate: string;
  scheduledPaidHours: number;
  recordedElapsedHours: number | null;
  proposedRegularHours: number | null;
  proposedOvertimeHours: number;
  proposedSundayHours: number;
  proposedHolidayHours: number;
  leaveHours: number;
  unpaidHours: number;
  attendanceClassification: AttendanceClassification | null;
  status: DailyResultStatus;
  exceptionKinds: DayExceptionKind[];
  calculationFingerprint: string;
}
