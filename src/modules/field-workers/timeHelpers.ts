/**
 * Pure helpers for the Time tab.
 *
 * - safeFormatTime: formats an ISO timestamp to HH:MM in SAST.
 * - safeFormatDate: formats an ISO date string to dd/mm/yyyy.
 * - getCurrentSastWeek: returns { from, to } for the current Mon–Sun
 *   in Africa/Johannesburg, formatted as YYYY-MM-DD strings.
 * - toLocalDatetimeValue: converts an ISO UTC string to the
 *   `datetime-local` input value in Africa/Johannesburg.
 * - fromLocalDatetimeValue: converts a `datetime-local` value (as
 *   entered in Africa/Johannesburg) back to a UTC ISO string.
 * - formatHours: format decimal hours as "Xh Ym" or "—".
 */

const SAST = 'Africa/Johannesburg';

// ── Date/time formatting ──────────────────────────────────────────────────────

/** Format an ISO timestamp (UTC) to "HH:MM" in SAST. Returns "—" on null. */
export function safeFormatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', {
      timeZone: SAST,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '—';
  }
}

/** Format a work_date (YYYY-MM-DD) to a short human-readable date. */
export function safeFormatDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  try {
    // Parse as local date to avoid UTC offset shifting the day.
    const parts = ymd.split('-').map(Number);
    const year = parts[0] ?? 0;
    const month = parts[1] ?? 1;
    const day = parts[2] ?? 1;
    return new Date(year, month - 1, day).toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return ymd;
  }
}

/** Format decimal hours as "Xh Ym". Returns "—" on null/zero. */
export function formatHours(hours: number | null | undefined): string {
  if (hours == null || hours <= 0) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── SAST week-range calculation ───────────────────────────────────────────────

/**
 * Returns the Mon–Sun ISO date strings (YYYY-MM-DD) for the week that contains
 * `baseDate` in Africa/Johannesburg time.
 *
 * If `baseDate` is omitted, today in SAST is used.
 */
export function getCurrentSastWeek(baseDate?: Date): { from: string; to: string } {
  const ref = baseDate ?? new Date();

  // Get the current date components in SAST.
  const sastParts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: SAST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ref);

  const y = Number(sastParts.find((p) => p.type === 'year')?.value ?? 0);
  const mo = Number(sastParts.find((p) => p.type === 'month')?.value ?? 0);
  const d = Number(sastParts.find((p) => p.type === 'day')?.value ?? 0);

  // Build a plain local Date so we can do day-of-week arithmetic without
  // UTC offset influence (month is 0-indexed).
  const today = new Date(y, mo - 1, d);
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const daysFromMon = dow === 0 ? 6 : dow - 1; // Mon=0 … Sun=6

  const mon = new Date(today);
  mon.setDate(today.getDate() - daysFromMon);

  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);

  return { from: toYMD(mon), to: toYMD(sun) };
}

/**
 * Today's date in Africa/Johannesburg as YYYY-MM-DD.
 *
 * Uses the SAST calendar parts rather than slicing toISOString(), which is UTC
 * and reports yesterday for the first two hours of every SAST day — exactly the
 * 00:00–02:00 window a night shift falls in.
 */
export function getSastToday(baseDate?: Date): string {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: SAST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(baseDate ?? new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const d = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${d}`;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── datetime-local <-> UTC ISO conversion ─────────────────────────────────────

/**
 * Converts a UTC ISO timestamp to the value format for a `datetime-local` input
 * in SAST ("YYYY-MM-DDTHH:MM").  Returns "" on null.
 */
export function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-ZA', {
      timeZone: SAST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return '';
  }
}

/**
 * Converts a `datetime-local` value ("YYYY-MM-DDTHH:MM") entered in SAST
 * back to a UTC ISO string.  Returns "" on empty input.
 */
export function fromLocalDatetimeValue(local: string): string {
  if (!local) return '';
  // Parse as a date-time in SAST by appending the SAST offset (+02:00).
  // Note: SAST is always UTC+2 (no DST).
  try {
    return new Date(`${local}:00+02:00`).toISOString();
  } catch {
    return '';
  }
}
