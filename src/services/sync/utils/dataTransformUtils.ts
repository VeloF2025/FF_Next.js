/**
 * Data Transformation Utilities
 * Functions for formatting and transforming data between systems
 */

/**
 * Data transformation and formatting utilities
 */
export class DataTransformUtils {
  /**
   * Format percentage with proper rounding
   */
  static formatPercentage(value: number, decimalPlaces: number = 2): string {
    if (isNaN(value) || !isFinite(value)) return '0.00';
    
    const multiplier = Math.pow(10, decimalPlaces);
    const rounded = Math.round(value * multiplier) / multiplier;
    return rounded.toFixed(decimalPlaces);
  }

  /**
   * Format currency value
   */
  static formatCurrency(value: number | string, currency: string = 'USD'): string {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(numValue) || !isFinite(numValue)) return '$0.00';
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(numValue);
  }

  /**
   * Sanitize string for database storage
   */
  static sanitizeString(value: any): string {
    if (value === null || value === undefined) return '';
    
    return String(value)
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .substring(0, 255); // Limit length
  }

  /**
   * Convert Firebase data to safe number
   */
  static toSafeNumber(value: any, defaultValue: number = 0): number {
    if (value === null || value === undefined) return defaultValue;
    
    const num = typeof value === 'string' ? parseFloat(value) : Number(value);
    return isNaN(num) || !isFinite(num) ? defaultValue : num;
  }

  /**
   * Convert Firebase data to safe integer
   */
  static toSafeInteger(value: any, defaultValue: number = 0): number {
    const num = this.toSafeNumber(value, defaultValue);
    return Math.round(num);
  }

  /**
   * Convert Firebase data to safe string
   */
  static toSafeString(value: any, defaultValue: string = ''): string {
    if (value === null || value === undefined) return defaultValue;
    return this.sanitizeString(value);
  }

  /**
   * Check if a value represents a valid percentage (0-100)
   */
  static isValidPercentage(value: any): boolean {
    const num = this.toSafeNumber(value, -1);
    return num >= 0 && num <= 100;
  }

  /**
   * Deep clone object (for Firebase data transformation)
   */
  static deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (obj instanceof Date) return new Date(obj.getTime()) as unknown as T;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as unknown as T;
    }
    
    const cloned = {} as T;
    Object.keys(obj).forEach(key => {
      (cloned as any)[key] = this.deepClone((obj as any)[key]);
    });
    
    return cloned;
  }

  /**
   * Get sync timestamp for logging
   */
  static getSyncTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format duration in milliseconds to human-readable string
   */
  static formatDuration(durationMs: number): string {
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${Math.round(durationMs / 1000 * 10) / 10}s`;
    if (durationMs < 3600000) return `${Math.round(durationMs / 60000 * 10) / 10}m`;
    return `${Math.round(durationMs / 3600000 * 10) / 10}h`;
  }

  /**
   * Convert bytes to human-readable format
   */
  static formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Parse CSV-like string values
   */
  static parseCSVValue(value: string): string[] {
    if (!value || typeof value !== 'string') return [];
    
    return value.split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0);
  }

  /**
   * Convert array to CSV string
   */
  static toCSVString(values: string[]): string {
    return values.map(value => value.trim()).join(', ');
  }

  /**
   * Normalize phone number format
   */
  static normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    
    // Remove all non-numeric characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Format as (XXX) XXX-XXXX for 10-digit numbers
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    
    // Format as +X (XXX) XXX-XXXX for 11-digit numbers starting with 1
    if (cleaned.length === 11 && cleaned[0] === '1') {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    
    return phone; // Return original if doesn't match expected patterns
  }

  /**
   * Normalize email address
   */
  static normalizeEmail(email: string): string {
    if (!email || typeof email !== 'string') return '';
    
    return email.toLowerCase().trim();
  }

  /**
   * Generate unique identifier
   */
  static generateUniqueId(prefix: string = ''): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    
    return prefix ? `${prefix}-${timestamp}-${randomPart}` : `${timestamp}-${randomPart}`;
  }
}