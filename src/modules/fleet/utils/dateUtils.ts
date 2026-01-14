/**
 * Date Utilities
 * Work hours detection and time categorization for GPS trip classification
 */

import type { TimeCategory, DayType } from '../types';

/**
 * Work hours configuration
 * Monday-Friday: 06:00 - 18:00 (6am to 6pm)
 */
const WORK_START_HOUR = 6; // 6am
const WORK_END_HOUR = 18; // 6pm

/**
 * Night time configuration
 * Night is considered 22:00 - 05:00 (10pm to 5am)
 */
const NIGHT_START_HOUR = 22; // 10pm
const NIGHT_END_HOUR = 5; // 5am

/**
 * Check if a date/time falls within work hours
 * Work hours: Monday-Friday, 06:00-18:00
 *
 * @param date - The date to check
 * @returns true if within work hours
 */
export function isWorkHours(date: Date): boolean {
  // Weekend is not work hours
  if (isWeekend(date)) {
    return false;
  }

  const hour = date.getHours();

  // Work hours: 6am (inclusive) to 6pm (exclusive)
  return hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
}

/**
 * Check if a date/time falls within night time
 * Night time: 22:00 - 05:00
 *
 * @param date - The date to check
 * @returns true if night time
 */
export function isNightTime(date: Date): boolean {
  const hour = date.getHours();

  // Night: 10pm to midnight OR midnight to 5am
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Check if a date falls on a weekend (Saturday or Sunday)
 *
 * @param date - The date to check
 * @returns true if weekend
 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  // Sunday = 0, Saturday = 6
  return day === 0 || day === 6;
}

/**
 * Get the time category for a date/time
 * Priority: NIGHT_TRAVEL > WORK_HOURS > AFTER_HOURS
 *
 * @param date - The date to categorize
 * @returns Time category
 */
export function getTimeCategory(date: Date): TimeCategory {
  // Night travel takes priority
  if (isNightTime(date)) {
    return 'NIGHT_TRAVEL';
  }

  // Check work hours (weekday 6am-6pm)
  if (isWorkHours(date)) {
    return 'WORK_HOURS';
  }

  // Everything else is after hours
  return 'AFTER_HOURS';
}

/**
 * Get the day type for a date
 *
 * @param date - The date to check
 * @returns Day type (WEEKDAY or WEEKEND)
 */
export function getDayType(date: Date): DayType {
  return isWeekend(date) ? 'WEEKEND' : 'WEEKDAY';
}

/**
 * Format duration in minutes to human readable string
 *
 * @param minutes - Duration in minutes
 * @returns Formatted string like "2h 30m" or "45m"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 1) {
    return '0m';
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hours === 0) {
    return `${mins}m`;
  }

  if (mins === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${mins}m`;
}

/**
 * Get the difference in minutes between two dates
 *
 * @param start - Start date
 * @param end - End date
 * @returns Duration in minutes
 */
export function getDurationMinutes(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return diff / (1000 * 60);
}

/**
 * Check if a date is the same calendar day as another date
 *
 * @param date1 - First date
 * @param date2 - Second date
 * @returns true if same calendar day
 */
export function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Get the date portion only (midnight) from a date
 *
 * @param date - The date
 * @returns Date at midnight
 */
export function getDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
