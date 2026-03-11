/**
 * Validation Utilities
 * Helper functions for validation
 */

export class ValidationUtilities {
  /**
   * Sanitize string input
   */
  sanitize(value: string): string {
    return value
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .substring(0, 1000); // Limit length
  }

  /**
   * Check if value is empty
   */
  isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === 'object' && Object.keys(value).length === 0) return true;
    return false;
  }

  /**
   * Format validation errors for display
   */
  formatErrors(errors: string[]): string {
    if (errors.length === 0) return '';
    if (errors.length === 1) return errors[0] ?? '';
    return `• ${errors.join('\n• ')}`;
  }
}