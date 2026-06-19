/**
 * Pure BCEA wage calculator. No DB, no side effects.
 *
 * Given a DailySummary (from overtimeCalculator) + the active rule +
 * the staff's hourly rate and Sunday status, returns the wage the day
 * would pay in cents, or null when we can't compute (incomplete
 * summary / missing rate).
 *
 * This is a REFERENCE number for payroll reconciliation — the export
 * still exposes all four hour buckets so the payroll vendor can apply
 * its own multipliers. wage_amount_cents is what FibreFlow would pay
 * if the configured rule were the ground truth.
 *
 * BCEA §6 exemption gate:
 *   Staff with bcea_applicable=false are above the s6 earnings threshold
 *   (R261,748.45/yr as of 2026) — they don't accrue OT / Sunday /
 *   holiday stacking. We pay regularHrs × rate only. The calculator
 *   already zeros out the other buckets for exempt staff; this module
 *   trusts that invariant and multiplies through.
 *
 * BCEA §15 Sunday + §18 holiday collision:
 *   With the #1990 disjoint-bucket model, sundayHrs and holidayHrs never
 *   overlap: a millisecond belongs to at most one bucket (holiday wins).
 *   For a cross-midnight Sunday→holiday shift both buckets are > 0 but
 *   cover different hours. We ADD each bucket × its multiplier — no Max.
 *
 * Sunday multiplier selection:
 *   - ordinarilyWorksSundays=true  → sundayOrdinaryMultiplier (1.5x typical)
 *   - ordinarilyWorksSundays=false → sundayMultiplierDefault  (2x typical)
 *
 * Weekday OT stacking:
 *   Pure weekday: regular × 1x + overtime × otMultiplier. On Sunday/holiday
 *   the premium-bucket hours pay at the day-rate multiplier. Any remaining
 *   ordinary hours in a cross-midnight shift (non-Sunday, non-holiday tail)
 *   pay at 1× — OT stacking on the cross-midnight ordinary tail is deferred.
 *
 * BCEA §17 night allowance:
 *   Additive on top of whatever rate applied. Each night hour pays an
 *   extra `nightShiftAllowance × rate` (typical 10%), NOT replacing
 *   the Sunday/holiday multiplier. Night overlaps regular/OT/Sun/Hol,
 *   so the total is base + (night × rate × allowance).
 *
 * Returns integer cents (Math.round on the final sum, which rounds half
 * AWAY from zero — not banker's rounding) so the DB BIGINT stays exact.
 */

import type { DailySummary, OvertimeRuleInput } from './overtimeCalculator';

export interface ComputeWageArgs {
  summary: DailySummary;
  rule: OvertimeRuleInput;
  /** Rate in cents per hour. Must be a non-negative finite integer. */
  hourlyRateCents: number;
  /** From staff.ordinarily_works_sundays. Selects Sunday multiplier. */
  ordinarilyWorksSundays: boolean;
}

/**
 * Returns wage in cents (rounded to integer), or null when we cannot
 * compute (incomplete summary, missing or invalid rate).
 */
export function computeWageCents(args: ComputeWageArgs): number | null {
  const { summary, rule, hourlyRateCents, ordinarilyWorksSundays } = args;

  if (summary.incomplete) return null;
  if (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0) return null;

  const onSunday = summary.sundayHrs > 0;
  const onHoliday = summary.holidayHrs > 0;

  // BCEA-exempt: no stacking. Pay regularHrs × rate only. The calculator
  // already zeros out OT / Sunday / holiday / night for exempt staff.
  if (summary.computationMode === 'bcea_exempt') {
    return Math.round(summary.regularHrs * hourlyRateCents);
  }

  let baseCents: number;
  if (onSunday || onHoliday) {
    const sundayMult = ordinarilyWorksSundays
      ? rule.sundayOrdinaryMultiplier
      : rule.sundayMultiplierDefault;
    // Disjoint buckets: ADD each portion × its multiplier. For a whole-day
    // Sunday/holiday shift ordinaryHrs is 0 and the result is identical to
    // the old (totalHrs × dayMult) formula. For cross-midnight splits each
    // premium bucket covers only the hours actually worked on that day type;
    // the remaining ordinary hours (non-Sunday, non-holiday cross-midnight
    // tail) pay at 1× — OT stacking on that tail is a deferred concern.
    const ordinaryHrs = Math.max(
      0,
      summary.regularHrs + summary.overtimeHrs - summary.sundayHrs - summary.holidayHrs,
    );
    baseCents =
      ordinaryHrs * hourlyRateCents +
      summary.sundayHrs * hourlyRateCents * sundayMult +
      summary.holidayHrs * hourlyRateCents * rule.holidayMultiplier;
  } else {
    // Weekday: regular @ 1x, overtime @ otMultiplier.
    baseCents =
      summary.regularHrs * hourlyRateCents +
      summary.overtimeHrs * hourlyRateCents * rule.otMultiplier;
  }

  const nightCents =
    summary.nightHrs * hourlyRateCents * rule.nightShiftAllowance;

  return Math.round(baseCents + nightCents);
}

/**
 * Converts a staff.hourly_rate numeric(8,2) value (rand) to integer
 * cents. Accepts number, string, or null/undefined. Returns null when
 * the input can't be parsed — callers treat that as "no rate captured".
 */
export function hourlyRateCentsFromDbValue(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
