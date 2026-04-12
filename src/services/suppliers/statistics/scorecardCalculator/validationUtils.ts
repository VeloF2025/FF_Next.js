/**
 * Validation Utilities
 * Handles validation of rating and performance values
 */

export class ValidationUtils {
  /**
   * Validate rating value (0-5 scale)
   */
  static validateRatingValue(value: unknown): number {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.max(0, Math.min(5, value));
  }

  /**
   * Validate percentage value (0-100 scale)
   */
  static validatePercentageValue(value: unknown): number {
    if (typeof value !== 'number' || isNaN(value)) return 0;
    return Math.max(0, Math.min(100, value));
  }

  /**
   * Validate numeric value within range
   */
  static validateNumericValue(value: unknown, min: number = 0, max: number = Number.MAX_VALUE): number {
    if (typeof value !== 'number' || isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Check if value is a valid non-negative number
   */
  static isValidPositiveNumber(value: unknown): boolean {
    return typeof value === 'number' && !isNaN(value) && value >= 0;
  }

  /**
   * Check if value is within percentage range (0-100)
   */
  static isValidPercentage(value: unknown): boolean {
    return this.isValidPositiveNumber(value) && (value as number) <= 100;
  }

  /**
   * Check if value is within rating range (0-5)
   */
  static isValidRating(value: unknown): boolean {
    return this.isValidPositiveNumber(value) && (value as number) <= 5;
  }

  /**
   * Sanitize and validate array of numbers
   */
  static validateNumberArray(values: unknown[], validator: (value: unknown) => number = this.validateNumericValue): number[] {
    if (!Array.isArray(values)) return [];
    return values.map(validator).filter(val => val >= 0);
  }

  /**
   * Check if date is valid and not in future
   */
  static isValidPastDate(date: unknown): boolean {
    if (!date) return false;
    const dateObj = new Date(date as string | number | Date);
    return !isNaN(dateObj.getTime()) && dateObj <= new Date();
  }
}
