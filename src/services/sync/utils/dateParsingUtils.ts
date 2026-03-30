/**
 * Date Parsing Utilities
 * Functions for parsing and manipulating Firebase date/timestamp objects
 */

import type { ParsedDate } from '../types';

/**
 * Date parsing and manipulation utilities
 */
export class DateParsingUtils {
  /**
   * Parse Firebase date/timestamp to JavaScript Date
   */
  static parseFirebaseDate(firebaseDate: any): Date | null {
    if (!firebaseDate) return null;
    
    // Firebase Timestamp with toDate method
    if (firebaseDate.toDate && typeof firebaseDate.toDate === 'function') {
      return firebaseDate.toDate();
    }
    
    // Firebase Timestamp with seconds property
    if (firebaseDate.seconds && typeof firebaseDate.seconds === 'number') {
      return new Date(firebaseDate.seconds * 1000);
    }
    
    // String or number date
    if (typeof firebaseDate === 'string' || typeof firebaseDate === 'number') {
      const date = new Date(firebaseDate);
      return isNaN(date.getTime()) ? null : date;
    }
    
    // Already a Date object
    if (firebaseDate instanceof Date) {
      return firebaseDate;
    }
    
    return null;
  }

  /**
   * Parse Firebase date with detailed result information
   */
  static parseFirebaseDateDetailed(firebaseDate: any): ParsedDate {
    if (!firebaseDate) {
      return {
        success: false,
        date: null,
        originalValue: firebaseDate,
        parseMethod: 'null'
      };
    }
    
    // Firebase Timestamp with toDate method
    if (firebaseDate.toDate && typeof firebaseDate.toDate === 'function') {
      try {
        return {
          success: true,
          date: firebaseDate.toDate(),
          originalValue: firebaseDate,
          parseMethod: 'toDate'
        };
      } catch (error) {
        return {
          success: false,
          date: null,
          originalValue: firebaseDate,
          parseMethod: 'toDate'
        };
      }
    }
    
    // Firebase Timestamp with seconds property
    if (firebaseDate.seconds && typeof firebaseDate.seconds === 'number') {
      return {
        success: true,
        date: new Date(firebaseDate.seconds * 1000),
        originalValue: firebaseDate,
        parseMethod: 'seconds'
      };
    }
    
    // String or number date
    if (typeof firebaseDate === 'string' || typeof firebaseDate === 'number') {
      const date = new Date(firebaseDate);
      const isValid = !isNaN(date.getTime());
      return {
        success: isValid,
        date: isValid ? date : null,
        originalValue: firebaseDate,
        parseMethod: typeof firebaseDate === 'string' ? 'string' : 'number'
      };
    }
    
    // Already a Date object
    if (firebaseDate instanceof Date) {
      return {
        success: true,
        date: firebaseDate,
        originalValue: firebaseDate,
        parseMethod: 'string'
      };
    }
    
    return {
      success: false,
      date: null,
      originalValue: firebaseDate,
      parseMethod: 'null'
    };
  }

  /**
   * Calculate days between two dates
   */
  static daysBetween(startDate: Date | null, endDate: Date | null): number {
    if (!startDate || !endDate) return 0;
    
    const timeDiff = endDate.getTime() - startDate.getTime();
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate working days between two dates (excludes weekends)
   */
  static workingDaysBetween(startDate: Date | null, endDate: Date | null): number {
    if (!startDate || !endDate) return 0;
    
    let workingDays = 0;
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not Sunday (0) or Saturday (6)
        workingDays++;
      }
      current.setDate(current.getDate() + 1);
    }
    
    return workingDays;
  }

  /**
   * Get current month date range
   */
  static getCurrentMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    return { start, end };
  }

  /**
   * Get previous month date range
   */
  static getPreviousMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    
    return { start, end };
  }

  /**
   * Get date range for specified months ago
   */
  static getMonthRangeAgo(monthsAgo: number): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0);
    
    return { start, end };
  }

  /**
   * Check if date is within range
   */
  static isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
    return date >= startDate && date <= endDate;
  }

  /**
   * Format date for database storage (ISO string)
   */
  static formatForDatabase(date: Date): string {
    return date.toISOString();
  }

  /**
   * Get start of day
   */
  static getStartOfDay(date: Date): Date {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
  }

  /**
   * Get end of day
   */
  static getEndOfDay(date: Date): Date {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  }

  /**
   * Get quarters from date range
   */
  static getQuarters(startDate: Date, endDate: Date): Array<{ start: Date; end: Date; quarter: string }> {
    const quarters: Array<{ start: Date; end: Date; quarter: string }> = [];
    const current = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth() / 3) * 3, 1);
    
    while (current <= endDate) {
      const quarterEnd = new Date(current.getFullYear(), current.getMonth() + 3, 0);
      const quarter = `Q${Math.floor(current.getMonth() / 3) + 1} ${current.getFullYear()}`;
      
      quarters.push({
        start: new Date(current),
        end: quarterEnd > endDate ? endDate : quarterEnd,
        quarter
      });
      
      current.setMonth(current.getMonth() + 3);
    }
    
    return quarters;
  }
}