/**
 * H&S injury-rate analytics types + definitions (goal Phase 6, §7.6)
 *
 * Rates use the standard 200,000-hour base (100 employees × 40h × 50 weeks), so
 * a rate is "injuries per 100 full-time workers per year".
 *
 *   LTIFR = lost-time injuries        × 200000 / man-hours
 *   DIFR  = disabling injuries        × 200000 / man-hours
 *   TRIFR = total recordable injuries × 200000 / man-hours
 *
 * Classification → which count each injury contributes to:
 *   fatality, lost_time      → LTI, disabling, recordable
 *   restricted_work          → disabling, recordable
 *   medical_treatment        → recordable
 *   first_aid                → none
 */

export const RATE_BASE_HOURS = 200_000;

export type InjuryClassification =
  | 'first_aid' | 'medical_treatment' | 'restricted_work' | 'lost_time' | 'fatality';

export const INJURY_CLASSIFICATIONS: { value: InjuryClassification; label: string }[] = [
  { value: 'first_aid', label: 'First aid only' },
  { value: 'medical_treatment', label: 'Medical treatment' },
  { value: 'restricted_work', label: 'Restricted work' },
  { value: 'lost_time', label: 'Lost-time injury' },
  { value: 'fatality', label: 'Fatality' },
];

export interface RateCounts {
  hours_worked: number;
  lost_time_injuries: number;   // fatality + lost_time
  disabling_injuries: number;   // + restricted_work
  recordable_injuries: number;  // + medical_treatment
  days_lost: number;
}

export interface InjuryRates extends RateCounts {
  ltifr: number | null;
  difr: number | null;
  trifr: number | null;
}

/** Rate = count × 200000 / hours; null when there are no hours to divide by. */
export function computeRate(count: number, hours: number): number | null {
  if (!hours || hours <= 0) return null;
  return Math.round((count * RATE_BASE_HOURS / hours) * 100) / 100;
}

export function deriveRates(c: RateCounts): InjuryRates {
  return {
    ...c,
    ltifr: computeRate(c.lost_time_injuries, c.hours_worked),
    difr: computeRate(c.disabling_injuries, c.hours_worked),
    trifr: computeRate(c.recordable_injuries, c.hours_worked),
  };
}
