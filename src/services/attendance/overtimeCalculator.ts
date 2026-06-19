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

import { computeDayTypeHours, MS_PER_HOUR } from './dayTypeHours';
import { computeNightHours, parseHm } from './nightHours';

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
  /**
   * Of `overtimeHrs`, how many fall on ORDINARY (non-Sunday, non-holiday)
   * calendar time. The wage calculator pays these at the s9/s10 OT
   * multiplier; the remaining OT coincides with a Sunday/holiday and is
   * paid at that day's premium (no stacking — matches single-day behaviour).
   * Derived from the time-ordered split (#2028); NOT persisted — the daily
   * summaries table only stores bucket totals.
   */
  overtimeOnNonPremiumHrs: number;
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
    overtimeOnNonPremiumHrs: 0,
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
      overtimeOnNonPremiumHrs: 0,
      ruleId: rule.id,
      computationMode: 'bcea_exempt',
      incomplete: false,
      weeklyOvertimeOverCap: false,
    };
  }

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

  // #1990 disjoint: holiday takes precedence over Sunday on the same calendar
  // day. #2028: the same time-ordered split also tells us how much of the OT
  // tail lands on ordinary (non-premium) time, which the wage calculator
  // needs to pay the OT premium correctly on cross-midnight shifts.
  const dayType = computeDayTypeHours(
    entry.clockInAt,
    entry.clockOutAt,
    publicHolidays,
    rule.dailyOrdinaryHrs,
  );
  const sundayHrs = roundHours(dayType.sundayHrs);
  const holidayHrs = roundHours(dayType.holidayHrs);
  // Clamp to [0, overtimeHrs] before rounding: the split is computed from raw
  // clock times while overtimeHrs uses the rounded threshold, so guard against
  // a sub-cent overshoot crediting more OT premium than OT exists.
  const overtimeOnNonPremiumHrs = roundHours(
    Math.min(overtimeHrs, Math.max(0, dayType.overtimeOnNonPremiumHrs)),
  );

  const weeklyOvertimeHrsAfter = weeklyOvertimeHrsBefore + overtimeHrs;
  const weeklyOvertimeOverCap = weeklyOvertimeHrsAfter > rule.weeklyOtCapHrs;

  return {
    regularHrs,
    overtimeHrs,
    sundayHrs,
    holidayHrs,
    nightHrs,
    overtimeOnNonPremiumHrs,
    ruleId: rule.id,
    computationMode: 'bcea_default',
    incomplete: false,
    weeklyOvertimeOverCap,
  };
}

function roundHours(hrs: number): number {
  return Math.round(hrs * 100) / 100;
}

// Helpers now live in sibling modules and are tested there:
//   - computeNightHours / parseHm → ./nightHours
//   - computeDayTypeHours / sastMidnight / sastYmd / overlapMs → ./dayTypeHours
export const __testing = {
  computeNightHours,
  parseHm,
};
