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
 * Weekday OT stacking (#2028):
 *   The stacking model matches single-day behaviour: an OT hour that
 *   COINCIDES with a Sunday/holiday is paid at that day's premium multiplier
 *   only — the s9/s10 OT premium does NOT stack on top (this is the reference
 *   set by the single-day "Sunday with OT → whole shift at Sunday multiplier"
 *   case). An OT hour that lands on ORDINARY calendar time pays at
 *   otMultiplier. `summary.overtimeOnNonPremiumHrs` (computed time-ordered in
 *   the producer) tells us exactly how many OT hours fall on the non-premium
 *   tail, so a cross-midnight shift no longer folds those OT hours into flat
 *   1× pay (the bug fixed here):
 *     nonPremiumOrdinary = (regular + overtime) − sunday − holiday
 *                          − overtimeOnNonPremium   → paid 1×
 *     overtimeOnNonPremium                          → paid otMultiplier
 *     sunday                                        → paid sundayMult
 *     holiday                                       → paid holidayMult
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
    // Disjoint buckets: ADD each portion × its multiplier (#1990/#2028).
    //  - Sunday/holiday hours pay their day multiplier (these absorb any OT
    //    that coincides with them — no s9/s10 stacking, matching single-day).
    //  - OT hours on the ORDINARY (non-premium) tail pay otMultiplier.
    //  - The rest of the ordinary tail pays 1×.
    // For a whole-day Sunday/holiday shift both ordinary terms are 0 and the
    // result equals the old (totalHrs × dayMult) formula.
    const overtimeOnNonPremiumHrs = Math.max(0, summary.overtimeOnNonPremiumHrs);
    const nonPremiumOrdinaryHrs = Math.max(
      0,
      summary.regularHrs +
        summary.overtimeHrs -
        summary.sundayHrs -
        summary.holidayHrs -
        overtimeOnNonPremiumHrs,
    );
    baseCents =
      nonPremiumOrdinaryHrs * hourlyRateCents +
      overtimeOnNonPremiumHrs * hourlyRateCents * rule.otMultiplier +
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
