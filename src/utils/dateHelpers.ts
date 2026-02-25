/**
 * Date Helper Utilities
 *
 * Safe date conversion for Firebase Timestamps, null values, etc.
 * Display formatting is delegated to @/utils/dateFormat.
 */

import { formatDisplayDate, formatDateISO, parseDateSafe } from '@/utils/dateFormat';

/**
 * Safely convert any date value to ISO string
 */
export function safeToISOString(date: any): string {
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
export function safeToDate(date: any): Date {
  const d = parseDateSafe(date);
  return d ?? new Date();
}

/**
 * Format date safely with fallback (ISO format for internal use)
 * @deprecated Use formatDateISO() or formatDisplayDate() from @/utils/dateFormat
 */
export function safeFormatDate(date: any, fallback: string = 'N/A'): string {
  return formatDateISO(date) || fallback;
}

/**
 * Format date for display
 * @deprecated Use formatDisplayDate() from @/utils/dateFormat
 */
export function formatDate(date: any, fallback: string = 'N/A'): string {
  return formatDisplayDate(date, fallback);
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
