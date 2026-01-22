/**
 * Standard Date Formatting Utility
 * All dates across the app should use YYYY-MM-DD format
 */

/**
 * Format date to YYYY-MM-DD standard
 * @param date - Date object, ISO string, or null
 * @returns Formatted date string or empty string if invalid
 */
export function formatDateStandard(date: Date | string | null | undefined): string {
  if (!date) return '';

  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';

    // Use ISO string and extract date portion (YYYY-MM-DD)
    return d.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Format date and time to YYYY-MM-DD HH:MM standard
 * @param date - Date object, ISO string, or null
 * @returns Formatted datetime string or empty string if invalid
 */
export function formatDateTimeStandard(date: Date | string | null | undefined): string {
  if (!date) return '';

  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '';

    const datePart = d.toISOString().split('T')[0];
    const timePart = d.toTimeString().slice(0, 5); // HH:MM
    return `${datePart} ${timePart}`;
  } catch {
    return '';
  }
}

/**
 * Format date for display with optional fallback
 * @param date - Date object, ISO string, or null
 * @param fallback - String to return if date is invalid
 * @returns Formatted date string or fallback
 */
export function formatDate(date: Date | string | null | undefined, fallback: string = 'N/A'): string {
  const formatted = formatDateStandard(date);
  return formatted || fallback;
}

/**
 * Format datetime for display with optional fallback
 * @param date - Date object, ISO string, or null
 * @param fallback - String to return if date is invalid
 * @returns Formatted datetime string or fallback
 */
export function formatDateTime(date: Date | string | null | undefined, fallback: string = 'N/A'): string {
  const formatted = formatDateTimeStandard(date);
  return formatted || fallback;
}

/**
 * Parse a YYYY-MM-DD string to Date object
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object or null if invalid
 */
export function parseDateStandard(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

  try {
    const d = new Date(dateString);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Get today's date in YYYY-MM-DD format
 * @returns Today's date as YYYY-MM-DD string
 */
export function getTodayStandard(): string {
  return formatDateStandard(new Date());
}

/**
 * Format date for Excel/CSV exports (YYYY-MM-DD)
 * @param date - Date object, ISO string, or null
 * @returns Formatted date string for exports
 */
export function formatDateForExport(date: Date | string | null | undefined): string {
  return formatDateStandard(date);
}
