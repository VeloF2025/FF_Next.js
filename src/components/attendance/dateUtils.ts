/**
 * Shared date helpers for attendance pages — kept in one place so the
 * "Monday of the SAST week containing X" convention doesn't drift between
 * the locks page, the bulk-lock modal, and any future surface that needs it.
 */

/** Today's date in SAST as YYYY-MM-DD. */
export function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** ISO Monday for the SAST week containing today. */
export function thisWeekMondaySast(): string {
  return isoMondayOf(todayInSast());
}

/**
 * Snap any YYYY-MM-DD to the Monday of its ISO week. Sunday → previous
 * Monday (delta -6); Mon→Sat → 1−dow.
 */
export function isoMondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay();
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMon);
  return d.toISOString().slice(0, 10);
}
