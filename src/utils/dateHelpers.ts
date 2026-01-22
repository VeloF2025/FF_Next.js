
/**
 * Safe date conversion utilities
 */

/**
 * Safely convert any date value to ISO string
 */
export function safeToISOString(date: any): string {
  try {
    // Handle null/undefined
    if (!date) {
      return new Date().toISOString();
    }

    // Handle Firebase Timestamp
    if (typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') {
      return date.toDate().toISOString();
    }

    // Handle ISO string
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return new Date().toISOString();
    }

    // Handle Date object
    if (date instanceof Date) {
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
      return new Date().toISOString();
    }

    // Handle number (timestamp)
    if (typeof date === 'number') {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return new Date().toISOString();
    }

    // Default to current date
    return new Date().toISOString();
  } catch (error) {
    // log.warn('Error converting date:', { data: error, date }, 'dateHelpers');
    return new Date().toISOString();
  }
}

/**
 * Safely convert any date value to Date object
 */
export function safeToDate(date: any): Date {
  try {
    // Handle null/undefined
    if (!date) {
      return new Date();
    }

    // Handle Firebase Timestamp
    if (typeof date === 'object' && 'toDate' in date && typeof date.toDate === 'function') {
      return date.toDate();
    }

    // Handle ISO string
    if (typeof date === 'string') {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      return new Date();
    }

    // Handle Date object
    if (date instanceof Date) {
      if (!isNaN(date.getTime())) {
        return date;
      }
      return new Date();
    }

    // Handle number (timestamp)
    if (typeof date === 'number') {
      const parsed = new Date(date);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      return new Date();
    }

    // Default to current date
    return new Date();
  } catch (error) {
    // log.warn('Error converting date:', { data: error, date }, 'dateHelpers');
    return new Date();
  }
}

/**
 * Format date safely with fallback
 * Standard format: YYYY-MM-DD
 */
export function safeFormatDate(date: any, fallback: string = 'N/A'): string {
  try {
    const dateObj = safeToDate(date);
    if (!isNaN(dateObj.getTime())) {
      // Standard YYYY-MM-DD format
      return dateObj.toISOString().split('T')[0];
    }
    return fallback;
  } catch (error) {
    // log.warn('Error formatting date:', { data: error, date }, 'dateHelpers');
    return fallback;
  }
}

/**
 * Format date for workflow components
 */
export function formatDate(date: any, fallback: string = 'N/A'): string {
  return safeFormatDate(date, fallback);
}

/**
 * Format duration in a human-readable format
 */
export function formatDuration(durationInDays: number): string {
  if (durationInDays < 1) {
    return '< 1 day';
  }
  
  if (durationInDays === 1) {
    return '1 day';
  }
  
  if (durationInDays < 7) {
    return `${Math.round(durationInDays)} days`;
  }
  
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