/**
 * Pure BCEA overtime calculator. No DB, no side effects.
 *
 * Inputs are assembled by the nightly reconcile cron (the DB reader) and
 * fed here as plain values. This file is covered by
 * __tests__/overtimeCalculator.test.ts.
 *
 * Scope (Phase 1b):
 *   - Daily bucket split for a single closed attendance entry.
 *   - BCEA s6 exemption (staff above threshold get no OT math).
 *   - BCEA s9 daily-ordinary split (default 9h weekday, OT above).
 *   - BCEA s16 Sunday classification (total Sunday hours surfaced; multiplier
 *     selection between 1.5x and 2x is a payroll-vendor concern — we record
 *     the staff's "ordinarily works Sundays" flag on the summary via
 *     computation_mode).
 *   - BCEA s17 night-shift hours (time inside rule's [night_start, night_end],
 *     with midnight wrap).
 *   - BCEA s18 public-holiday classification (holidayHrs dual-reports
 *     alongside regular/OT so the export can present all four to the payroll
 *     vendor).
 *   - Weekly OT cap DETECTION (s10 max 10h/week). The calculator does not
 *     silently cap — that would hide BCEA violations. The cron raises an
 *     exception when `weeklyOvertimeOverCap` is true.
 *
 * Out of scope (future work, stubbed):
 *   - s11 averaging agreements (up to 45h/week averaged over 4 months).
 *   - Per-staff rule overrides (collective agreements).
 *   - Wage amount computation (no staff hourly rate column yet).
 */

import { isSunday } from './saPublicHolidays';

export interface AttendanceEntryInput {
  /** 'YYYY-MM-DD' in SAST — the day this entry belongs to for payroll. */
  workDate: string;
  clockInAt: Date;
  /** Null when the entry is still open; calculator returns `incomplete`. */
  clockOutAt: Date | null;
}

export interface OvertimeRuleInput {
  id: string;
  dailyOrdinaryHrs: number;
  /**
   * Carried through for the weekly roll-up post-pass (Phase 1b PR B's
   * reconcile cron) — not read by the per-day calculator. Flagged here so
   * callers don't assume the daily split already honours the weekly ordinary
   * cap.
   */
  weeklyOrdinaryHrs: number;
  weeklyOtCapHrs: number;
  otMultiplier: number;
  sundayMultiplierDefault: number;
  sundayOrdinaryMultiplier: number;
  holidayMultiplier: number;
  nightShiftAllowance: number;
  /** 'HH:MM' or 'HH:MM:SS' SAST. */
  nightStart: string;
  /** 'HH:MM' or 'HH:MM:SS' SAST — midnight wrap when nightEnd < nightStart. */
  nightEnd: string;
}

export type ComputationMode = 'bcea_default' | 'bcea_exempt' | 'collective_agreement';

export interface DailySummary {
  regularHrs: number;
  overtimeHrs: number;
  sundayHrs: number;
  holidayHrs: number;
  nightHrs: number;
  ruleId: string;
  computationMode: ComputationMode;
  /** True when the entry is still open or has zero/negative duration. */
  incomplete: boolean;
  /** True when this day's OT pushes the running weekly total above weeklyOtCapHrs. */
  weeklyOvertimeOverCap: boolean;
}

export interface CalculateDailySummaryArgs {
  entry: AttendanceEntryInput;
  rule: OvertimeRuleInput;
  publicHolidays: ReadonlySet<string>;
  staffBceaApplicable: boolean;
  /**
   * OT hours already booked for this staff in the same payroll week STRICTLY
   * BEFORE this workDate. Must be a finite non-negative number; NaN throws
   * rather than silently bypassing the cap check.
   *
   * CRITICAL — cap detection contract: callers MUST invoke this function
   * per-staff per-day in chronological order for `weeklyOvertimeOverCap` to
   * be meaningful. Parallel/per-day recomputation with everyone seeing 0
   * defeats the cap check. A mid-week backfill MUST replay all subsequent
   * days in order. This is why the field name has "Before" in it.
   * Default 0.
   */
  weeklyOvertimeHrsBefore?: number;
}

/** BCEA s9: physically plausible shift length. Beyond this, treat as data-quality bug. */
const MAX_PLAUSIBLE_SHIFT_HRS = 24;

export function calculateDailySummary(args: CalculateDailySummaryArgs): DailySummary {
  const {
    entry,
    rule,
    publicHolidays,
    staffBceaApplicable,
  } = args;

  const beforeRaw = args.weeklyOvertimeHrsBefore ?? 0;
  if (!Number.isFinite(beforeRaw) || beforeRaw < 0) {
    throw new Error(
      `calculateDailySummary: weeklyOvertimeHrsBefore must be a finite non-negative number; got ${String(
        args.weeklyOvertimeHrsBefore
      )}`
    );
  }
  const weeklyOvertimeHrsBefore = beforeRaw;

  const nightStart = parseHm(rule.nightStart);
  const nightEnd = parseHm(rule.nightEnd);
  if (nightStart.hour === nightEnd.hour && nightStart.minute === nightEnd.minute) {
    throw new Error(
      `calculateDailySummary: degenerate night rule — nightStart (${rule.nightStart}) ` +
        `equals nightEnd (${rule.nightEnd}); would silently pay night allowance on every hour. ` +
        `Fix the rule profile before computing summaries.`
    );
  }

  const emptyBuckets = {
    regularHrs: 0,
    overtimeHrs: 0,
    sundayHrs: 0,
    holidayHrs: 0,
    nightHrs: 0,
  };

  if (!entry.clockOutAt) {
    return {
      ...emptyBuckets,
      ruleId: rule.id,
      computationMode: staffBceaApplicable ? 'bcea_default' : 'bcea_exempt',
      incomplete: true,
      weeklyOvertimeOverCap: false,
    };
  }

  const totalMs = entry.clockOutAt.getTime() - entry.clockInAt.getTime();
  if (totalMs <= 0) {
    return {
      ...emptyBuckets,
      ruleId: rule.id,
      computationMode: staffBceaApplicable ? 'bcea_default' : 'bcea_exempt',
      incomplete: true,
      weeklyOvertimeOverCap: false,
    };
  }

  const rawTotalHrs = totalMs / MS_PER_HOUR;

  // A single shift longer than 24h is physically implausible — almost
  // always a missed clock-out that the reconcile cron should have
  // auto-closed. Return incomplete so the cron raises an exception rather
  // than booking double-digit night hours.
  if (rawTotalHrs > MAX_PLAUSIBLE_SHIFT_HRS) {
    return {
      ...emptyBuckets,
      ruleId: rule.id,
      computationMode: staffBceaApplicable ? 'bcea_default' : 'bcea_exempt',
      incomplete: true,
      weeklyOvertimeOverCap: false,
    };
  }

  const totalHrs = roundHours(rawTotalHrs);

  if (!staffBceaApplicable) {
    return {
      regularHrs: totalHrs,
      overtimeHrs: 0,
      sundayHrs: 0,
      holidayHrs: 0,
      nightHrs: 0,
      ruleId: rule.id,
      computationMode: 'bcea_exempt',
      incomplete: false,
      weeklyOvertimeOverCap: false,
    };
  }

  const isHoliday = publicHolidays.has(entry.workDate);
  const sunday = isSunday(entry.workDate);

  const nightHrs = roundHours(
    computeNightHours(entry.clockInAt, entry.clockOutAt, nightStart, nightEnd)
  );

  // Compare RAW hours to the daily-ordinary threshold so a shift like
  // 9h00m18s doesn't silently fall into the all-regular branch because
  // `roundHours(9.005) === 9.00`. Buckets are rounded after splitting.
  let regularHrs: number;
  let overtimeHrs: number;
  if (rawTotalHrs <= rule.dailyOrdinaryHrs) {
    regularHrs = totalHrs;
    overtimeHrs = 0;
  } else {
    regularHrs = roundHours(rule.dailyOrdinaryHrs);
    overtimeHrs = roundHours(rawTotalHrs - rule.dailyOrdinaryHrs);
  }

  const sundayHrs = sunday ? totalHrs : 0;
  const holidayHrs = isHoliday ? totalHrs : 0;

  const weeklyOvertimeHrsAfter = weeklyOvertimeHrsBefore + overtimeHrs;
  const weeklyOvertimeOverCap = weeklyOvertimeHrsAfter > rule.weeklyOtCapHrs;

  return {
    regularHrs,
    overtimeHrs,
    sundayHrs,
    holidayHrs,
    nightHrs,
    ruleId: rule.id,
    computationMode: 'bcea_default',
    incomplete: false,
    weeklyOvertimeOverCap,
  };
}

const MS_PER_HOUR = 3600_000;
const MS_PER_DAY = 86_400_000;

function roundHours(hrs: number): number {
  return Math.round(hrs * 100) / 100;
}

function parseHm(s: string): { hour: number; minute: number } {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`parseHm: invalid time '${s}' (expected HH:MM or HH:MM:SS)`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`parseHm: out-of-range time '${s}'`);
  }
  return { hour, minute };
}

function sastMidnight(d: Date): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const ymd = fmt.format(d);
  return new Date(`${ymd}T00:00:00+02:00`);
}

function addSastHm(midnight: Date, hm: { hour: number; minute: number }): Date {
  return new Date(midnight.getTime() + (hm.hour * 60 + hm.minute) * 60 * 1000);
}

function overlapMs(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const lo = Math.max(aStart.getTime(), bStart.getTime());
  const hi = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, hi - lo);
}

function computeNightHours(
  clockIn: Date,
  clockOut: Date,
  nightStart: { hour: number; minute: number },
  nightEnd: { hour: number; minute: number }
): number {
  const totalMs = clockOut.getTime() - clockIn.getTime();
  if (totalMs <= 0) return 0;

  const dayStart = nightEnd;
  const dayEnd = nightStart;

  const startMidnight = sastMidnight(clockIn);
  let nightMs = 0;

  for (let offsetDays = -1; offsetDays <= 2; offsetDays++) {
    const mid = new Date(startMidnight.getTime() + offsetDays * MS_PER_DAY);
    const nextMid = new Date(mid.getTime() + MS_PER_DAY);

    const workedOnDayMs = overlapMs(clockIn, clockOut, mid, nextMid);
    if (workedOnDayMs === 0) continue;

    const dayPeriodStart = addSastHm(mid, dayStart);
    const dayPeriodEnd = addSastHm(mid, dayEnd);
    if (dayPeriodStart.getTime() >= dayPeriodEnd.getTime()) {
      nightMs += workedOnDayMs;
      continue;
    }

    const dayPeriodMs = overlapMs(clockIn, clockOut, dayPeriodStart, dayPeriodEnd);
    nightMs += workedOnDayMs - dayPeriodMs;
  }

  return nightMs / MS_PER_HOUR;
}

export const __testing = {
  computeNightHours,
  sastMidnight,
  parseHm,
};
