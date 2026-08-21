import { query } from '@/lib/db-pool';
import { findEffectivePolicy, type AttendancePolicyReader } from '@/services/attendance/reconcileQueries';
import type { AttendanceSchedulePolicy } from '@/services/attendance/policy/types';
import { weekdayFor } from '@/services/attendance/policy/calculateDailyResult';
import type { AssignmentRosterFilters } from './rosterQueries';

/**
 * One day's expectation, resolved from the SINGLE attendance schedule policy.
 *
 * There is deliberately no per-staff policy here. Fleet reads the same policy
 * payroll reconciles against, because the roster's expected start/end drive
 * `late` and `left_early` incidents — disciplinary findings about named people.
 * A second source of truth for expected hours would let fleet call a driver
 * late against hours payroll does not recognise.
 *
 * Absence is always "no expectation", never a default. An uncovered date
 * yields scheduled=false and NULL times rather than 08:00-17:00, because a
 * fabricated expectation produces a fabricated accusation.
 *
 * KNOWN LIMIT: the oldest policy starts 2026-04-24, so any date before that is
 * uncovered and correctly yields no expectation. It is the same coverage gap
 * that keeps payroll lock non-functional (issue #2382).
 */
export interface RosterScheduleDay {
  workDate: string;
  scheduled: boolean;
  startTime: string | null;
  endTime: string | null;
}

const NO_EXPECTATION = (workDate: string): RosterScheduleDay =>
  ({ workDate, scheduled: false, startTime: null, endTime: null });

/**
 * Mirrors `getDaySchedule` in services/attendance/policy/calculateDailyResult.ts
 * exactly: Sunday is never scheduled and has no window, Saturday uses the
 * Saturday columns, Monday-Friday use the weekday columns. Do not reinterpret
 * these columns here — attendance owns that reading, and this shares its
 * `weekdayFor` rather than re-deriving the day so the two cannot drift.
 */
export function rosterScheduleDay(
  workDate: string,
  policy: AttendanceSchedulePolicy | null,
): RosterScheduleDay {
  if (!policy) return NO_EXPECTATION(workDate);
  const weekday = weekdayFor(workDate);
  if (weekday === 0) return NO_EXPECTATION(workDate);
  const saturday = weekday === 6;
  return {
    workDate,
    scheduled: true,
    startTime: saturday ? policy.saturdayStart : policy.weekdayStart,
    endTime: saturday ? policy.saturdayEnd : policy.weekdayEnd,
  };
}

/**
 * Resolves the expectation for every day the roster query will generate.
 *
 * The date list comes from the database using the same expression the roster
 * SQL uses, so the two cannot disagree about what "today" is when the session
 * timezone is not SAST. One findEffectivePolicy call per day: ranges here are
 * days-to-weeks, and the null-returning variant is required so a single
 * uncovered day cannot abort a whole monitor tick for every driver.
 */
export async function resolveRosterSchedule(
  filters: AssignmentRosterFilters = {},
  reader: AttendancePolicyReader = query,
): Promise<RosterScheduleDay[]> {
  const days = await reader<{ work_date: string }>(
    `SELECT day::date::text AS work_date
     FROM generate_series(COALESCE($1::date, CURRENT_DATE), COALESCE($2::date, CURRENT_DATE), interval '1 day') day`,
    [filters.startDate ?? null, filters.endDate ?? null],
  );
  return Promise.all(days.map(async ({ work_date }) =>
    rosterScheduleDay(work_date, await findEffectivePolicy(work_date, reader))));
}
