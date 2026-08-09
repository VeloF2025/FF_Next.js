const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today in SAST as yyyy-mm-dd, which is what a date input expects. */
export const sastToday = (): string => dayFormatter.format(new Date());

/**
 * The instant a chosen day should record.
 *
 * Today records the actual moment, not midnight: the command rejects an
 * effective time in the future, and it treats anything more than five minutes
 * old as back-dated and demands a reason. Recording "today" as midnight would
 * therefore make the ordinary case — he submitted a PON just now — ask him to
 * justify himself. Earlier days record midday SAST, far enough from either
 * boundary that no timezone rounding can move the date.
 */
export function effectiveAtFor(day: string, today = sastToday()): string {
  return day >= today ? new Date().toISOString() : new Date(`${day}T12:00:00+02:00`).toISOString();
}
