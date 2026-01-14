/**
 * Excel Date Parser
 * Converts Excel serial dates to JavaScript Date objects
 *
 * Excel stores dates as numbers (serial dates) where:
 * - 1 = January 1, 1900
 * - The fractional part represents the time of day
 * - Note: Excel incorrectly treats 1900 as a leap year (bug from Lotus 1-2-3)
 */

/**
 * Milliseconds in a day
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convert an Excel serial date to a JavaScript Date object
 *
 * Excel uses two date systems:
 * - 1900 date system (Windows default): Day 1 = January 1, 1900
 * - 1904 date system (Mac default): Day 1 = January 2, 1904
 *
 * We use the 1900 system. Excel has a bug where it thinks 1900 was a leap year.
 *
 * @param serial - Excel serial date number
 * @returns JavaScript Date object or null if invalid
 */
export function excelDateToJSDate(serial: number): Date | null {
  // Validate input
  if (!isExcelSerialDate(serial)) {
    return null;
  }

  // Excel serial date starts at 1 = January 1, 1900
  // But Excel incorrectly thinks 1900 was a leap year (Lotus 1-2-3 bug)
  // So serial 60 = Feb 29, 1900 (which doesn't exist)
  // For dates after Feb 28, 1900, we need to subtract 1

  // Calculate days from January 0, 1900 (Excel's "day 0")
  // We use January 1, 1900 as our reference and adjust
  const daysSinceExcelEpoch = serial > 60 ? serial - 2 : serial - 1;

  // Create date: January 1, 1900 + days
  const date = new Date(1900, 0, 1 + daysSinceExcelEpoch);

  // Handle the fractional part (time)
  const fraction = serial % 1;
  if (fraction > 0) {
    const totalMs = fraction * MS_PER_DAY;
    date.setMilliseconds(date.getMilliseconds() + totalMs);
  }

  return date;
}

/**
 * Check if a value is a valid Excel serial date
 *
 * @param value - The value to check
 * @returns true if valid Excel serial date
 */
export function isExcelSerialDate(value: unknown): value is number {
  if (typeof value !== 'number') {
    return false;
  }

  if (isNaN(value) || !isFinite(value)) {
    return false;
  }

  // Excel serial dates start at 1 (January 1, 1900)
  // Maximum reasonable value is ~100000 (year 2173)
  return value > 0 && value < 200000;
}

/**
 * Parse various date formats to JavaScript Date
 * Handles: Excel serial numbers, date strings, Date objects
 *
 * @param value - The value to parse
 * @returns JavaScript Date object or null if invalid
 */
export function parseExcelDate(value: unknown): Date | null {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }

  // Already a Date object
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Number - likely Excel serial date
  if (typeof value === 'number') {
    // Check if it looks like an Excel serial date
    if (isExcelSerialDate(value)) {
      return excelDateToJSDate(value);
    }
    return null;
  }

  // String - could be serial number or date string
  if (typeof value === 'string') {
    const trimmed = value.trim();

    // Empty string
    if (!trimmed) {
      return null;
    }

    // First, try to parse as ISO date string (YYYY-MM-DD format)
    // Check if it looks like a date string (contains dashes or slashes)
    if (trimmed.includes('-') || trimmed.includes('/')) {
      const parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    // Try to parse as number (Excel serial) - only if it's a pure number
    const num = parseFloat(trimmed);
    if (!isNaN(num) && trimmed === String(num) && isExcelSerialDate(num)) {
      return excelDateToJSDate(num);
    }

    // Also try if string is just a number with decimals
    if (/^\d+(\.\d+)?$/.test(trimmed) && isExcelSerialDate(num)) {
      return excelDateToJSDate(num);
    }

    // Try to parse as date string (fallback)
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }

    return null;
  }

  return null;
}

/**
 * Convert time fraction to hours, minutes, seconds
 *
 * @param fraction - Fractional part of Excel serial (0-1)
 * @returns Object with hours, minutes, seconds
 */
export function excelTimeToHMS(fraction: number): {
  hours: number;
  minutes: number;
  seconds: number;
} {
  const totalSeconds = Math.round(fraction * 86400); // 24 * 60 * 60
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { hours, minutes, seconds };
}

/**
 * Format a date to ISO string (YYYY-MM-DD)
 *
 * @param date - The date to format
 * @returns ISO date string
 */
export function formatDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date to datetime string (YYYY-MM-DD HH:MM:SS)
 *
 * @param date - The date to format
 * @returns Datetime string
 */
export function formatDateTimeISO(date: Date): string {
  const datePart = formatDateISO(date);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${datePart} ${hours}:${minutes}:${seconds}`;
}
