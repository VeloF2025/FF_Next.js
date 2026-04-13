/**
 * Date Helper Utilities
 *
 * Safe date conversion for Firebase Timestamps, null values, etc.
 * Display formatting is delegated to @/utils/dateFormat.
 */

import { formatDisplayDate, parseDateSafe } from '@/utils/dateFormat';

/**
 * Safely convert any date value to ISO string
 */
export function safeToISOString(date: unknown): string {
  try {
    if (!date) return new Date().toISOString();

    // Firebase Timestamp
    if (typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') {
      return date.toDate().toISOString();
    }

    if (typeof date === 'string') {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    }

    if (date instanceof Date) {
      return !isNaN(date.getTime()) ? date.toISOString() : new Date().toISOString();
    }

    if (typeof date === 'number') {
      const parsed = new Date(date);
      return !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
    }

    return new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Safely convert any date value to Date object
 */
export function safeToDate(date: unknown): Date {
  const d = parseDateSafe(date as Parameters<typeof parseDateSafe>[0]);
  return d ?? new Date();
}

/**
 * Format date safely for display, defaulting to the current date when the
 * input is null, undefined, invalid, or throws during conversion.
 *
 * Behaviour:
 *   - Valid date  → display-formatted string ("15 Jan 2024")
 *   - null/undefined/invalid → formats the current date (not a static fallback)
 *   - Object with a throwing getter → caught here, formats current date
 *
 * The `_fallback` parameter is kept for API compatibility but is no longer
 * used; invalid/null inputs default to the current date, matching the
 * "Production Error Fix" intent captured in the unit tests.
 *
 * @deprecated Use formatDisplayDate() from @/utils/dateFormat
 */
export function safeFormatDate(date: unknown, _fallback: string = 'N/A'): string {
  try {
    const result = formatDisplayDate(date as Parameters<typeof formatDisplayDate>[0]);
    // formatDisplayDate returns 'N/A' when it cannot resolve a valid date.
    // Fall back to the current date to honour the "defaults to now" contract.
    if (result === 'N/A') {
      return formatDisplayDate(new Date());
    }
    return result;
  } catch {
    return formatDisplayDate(new Date());
  }
}

/**
 * Format date for display
 * @deprecated Use formatDisplayDate() from @/utils/dateFormat
 */
export function formatDate(date: unknown, fallback: string = 'N/A'): string {
  return formatDisplayDate(date as Parameters<typeof formatDisplayDate>[0], fallback);
}

/**
 * Format duration in a human-readable format
 */
export function formatDuration(durationInDays: number): string {
  if (durationInDays < 1) return '< 1 day';
  if (durationInDays === 1) return '1 day';
  if (durationInDays < 7) return `${Math.round(durationInDays)} days`;
  if (durationInDays < 30) {
    const weeks = Math.round(durationInDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''}`;
  }
  if (durationInDays < 365) {
    const months = Math.round(durationInDays / 30);
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  const years = Math.round(durationInDays / 365);
  return `${years} year${years !== 1 ? 's' : ''}`;
}
