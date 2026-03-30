/**
 * Synchronization Utilities - Main Service
 * Entry point for all sync utility functions
 */

import { DateParsingUtils } from './utils/dateParsingUtils';
import { DataTransformUtils } from './utils/dataTransformUtils';
import { CalculationUtils } from './utils/calculationUtils';
import { BatchProcessingUtils } from './utils/batchProcessingUtils';
import type { ParsedDate } from './types';

/**
 * Utility functions for sync operations
 */
export class SyncUtils {
  /**
   * Parse Firebase date/timestamp to JavaScript Date
   */
  static parseFirebaseDate(firebaseDate: any): Date | null {
    return DateParsingUtils.parseFirebaseDate(firebaseDate);
  }

  /**
   * Parse Firebase date with detailed result information
   */
  static parseFirebaseDateDetailed(firebaseDate: any): ParsedDate {
    return DateParsingUtils.parseFirebaseDateDetailed(firebaseDate);
  }

  /**
   * Calculate days between two dates
   */
  static daysBetween(startDate: Date | null, endDate: Date | null): number {
    return DateParsingUtils.daysBetween(startDate, endDate);
  }

  /**
   * Calculate working days between two dates (excludes weekends)
   */
  static workingDaysBetween(startDate: Date | null, endDate: Date | null): number {
    return DateParsingUtils.workingDaysBetween(startDate, endDate);
  }

  /**
   * Format percentage with proper rounding
   */
  static formatPercentage(value: number, decimalPlaces: number = 2): string {
    return DataTransformUtils.formatPercentage(value, decimalPlaces);
  }

  /**
   * Format currency value
   */
  static formatCurrency(value: number | string, currency: string = 'USD'): string {
    return DataTransformUtils.formatCurrency(value, currency);
  }

  /**
   * Sanitize string for database storage
   */
  static sanitizeString(value: any): string {
    return DataTransformUtils.sanitizeString(value);
  }

  /**
   * Convert Firebase data to safe number
   */
  static toSafeNumber(value: any, defaultValue: number = 0): number {
    return DataTransformUtils.toSafeNumber(value, defaultValue);
  }

  /**
   * Convert Firebase data to safe integer
   */
  static toSafeInteger(value: any, defaultValue: number = 0): number {
    return DataTransformUtils.toSafeInteger(value, defaultValue);
  }

  /**
   * Convert Firebase data to safe string
   */
  static toSafeString(value: any, defaultValue: string = ''): string {
    return DataTransformUtils.toSafeString(value, defaultValue);
  }

  /**
   * Check if a value represents a valid percentage (0-100)
   */
  static isValidPercentage(value: any): boolean {
    return DataTransformUtils.isValidPercentage(value);
  }

  /**
   * Get current month date range
   */
  static getCurrentMonthRange(): { start: Date; end: Date } {
    return DateParsingUtils.getCurrentMonthRange();
  }

  /**
   * Get previous month date range
   */
  static getPreviousMonthRange(): { start: Date; end: Date } {
    return DateParsingUtils.getPreviousMonthRange();
  }

  /**
   * Get date range for specified months ago
   */
  static getMonthRangeAgo(monthsAgo: number): { start: Date; end: Date } {
    return DateParsingUtils.getMonthRangeAgo(monthsAgo);
  }

  /**
   * Calculate completion percentage
   */
  static calculateCompletionPercentage(completed: number, total: number): number {
    return CalculationUtils.calculateCompletionPercentage(completed, total);
  }

  /**
   * Calculate weighted average
   */
  static calculateWeightedAverage(values: Array<{ value: number; weight: number }>): number {
    return CalculationUtils.calculateWeightedAverage(values);
  }

  /**
   * Batch process array items
   */
  static async batchProcess<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    batchSize: number = 10,
    delayMs: number = 100
  ): Promise<R[]> {
    return BatchProcessingUtils.batchProcess(items, processor, batchSize, delayMs);
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<T> {
    return BatchProcessingUtils.retryWithBackoff(operation, maxRetries, baseDelayMs);
  }

  /**
   * Deep clone object (for Firebase data transformation)
   */
  static deepClone<T>(obj: T): T {
    return DataTransformUtils.deepClone(obj);
  }

  /**
   * Get sync timestamp for logging
   */
  static getSyncTimestamp(): string {
    return DataTransformUtils.getSyncTimestamp();
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  static formatDuration(durationMs: number): string {
    return DataTransformUtils.formatDuration(durationMs);
  }
}