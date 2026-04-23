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
 *   A Sunday that also happens to be a public holiday (e.g. Christmas
 *   2022) pays the HIGHER of the two multipliers, not the sum. This
 *   module picks max(sundayMult, holidayMult) and applies it once.
 *
 * Sunday multiplier selection:
 *   - ordinarilyWorksSundays=true  → sundayOrdinaryMultiplier (1.5x typical)
 *   - ordinarilyWorksSundays=false → sundayMultiplierDefault  (2x typical)
 *
 * Weekday OT stacking:
 *   Weekday = regular × 1x + overtime × otMultiplier. On Sunday/holiday
 *   we don't stack OT — the Sunday/holiday multiplier rewards the whole
 *   shift. (regularHrs + overtimeHrs) × day-multiplier.
 *
 * BCEA §17 night allowance:
 *   Additive on top of whatever rate applied. Each night hour pays an
 *   extra `nightShiftAllowance × rate` (typical 10%), NOT replacing
 *   the Sunday/holiday multiplier. Night overlaps regular/OT/Sun/Hol,
 *   so the total is base + (night × rate × allowance).
 *
 * Returns integer cents (ROUND-HALF-TO-EVEN via Math.round's banker's
 * rounding on the final sum) so the DB BIGINT stays exact.
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
    const dayMult =
      onSunday && onHoliday
        ? Math.max(sundayMult, rule.holidayMultiplier)
        : onSunday
          ? sundayMult
          : rule.holidayMultiplier;
    // No OT stacking on Sunday/holiday: the whole shift earns dayMult.
    baseCents =
      (summary.regularHrs + summary.overtimeHrs) * hourlyRateCents * dayMult;
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
