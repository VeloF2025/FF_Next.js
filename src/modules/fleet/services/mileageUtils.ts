/**
 * Fleet Mileage Utilities
 * Shared helpers for mileage API routes
 */

import type { MileagePeriod } from '../types/mileage.types';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Get default date range for a period */
export function getDefaultDateRange(period: MileagePeriod): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  const endDate = end.toISOString().split('T')[0]!;

  switch (period) {
    case 'daily':
      start.setDate(start.getDate() - 30);
      break;
    case 'weekly':
      start.setDate(start.getDate() - 91);
      break;
    case 'monthly':
    default:
      start.setFullYear(start.getFullYear() - 1);
      break;
  }

  return { startDate: start.toISOString().split('T')[0]!, endDate };
}

/** Validate a date string is YYYY-MM-DD format */
export function isValidDate(value: string): boolean {
  if (!DATE_REGEX.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate a UUID string */
export function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}
