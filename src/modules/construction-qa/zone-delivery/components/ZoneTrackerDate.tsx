/**
 * A date, and only a date. The tracker's columns are the ones Johan keeps in
 * Excel — "05/08" — so the time and timezone the delivery workspace shows would
 * be noise here. Africa/Johannesburg is pinned rather than left to the browser
 * so the rendered day is the South African one for every viewer; the underlying
 * columns are timestamptz, so this is a display choice and not a correction.
 */
const formatter = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Africa/Johannesburg',
});

export function ZoneTrackerDate({ value }: { value: string | null }) {
  if (!value) return <span className="text-[var(--ff-text-secondary)]">—</span>;
  return <time dateTime={value}>{formatter.format(new Date(value))}</time>;
}
