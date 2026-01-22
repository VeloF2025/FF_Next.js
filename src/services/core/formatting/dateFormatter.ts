/**
 * Date Formatter
 * Handles date, time, and duration formatting
 */

import type { DateFormatOptions } from './types';
import { log } from '@/lib/logger';

export class DateFormatter {
  private defaultLocale = 'en-US';

  // Date and time formatting
  // Standard format: YYYY-MM-DD
  date(
    date: Date | string,
    options: DateFormatOptions = {}
  ): string {
    const {
      timeStyle,
      timeZone,
    } = options;

    const dateObj = typeof date === 'string' ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      return 'Invalid Date';
    }

    try {
      // Standard YYYY-MM-DD format
      const datePart = dateObj.toISOString().split('T')[0];

      // If time is requested, append it
      if (timeStyle) {
        const timeOptions: Intl.DateTimeFormatOptions = {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        };
        if (timeZone) timeOptions.timeZone = timeZone;
        const timePart = dateObj.toLocaleTimeString('en-GB', timeOptions);
        return `${datePart} ${timePart}`;
      }

      return datePart;
    } catch (error) {
      log.warn('Date formatting failed:', { data: error }, 'dateFormatter');
      return dateObj.toISOString().split('T')[0];
    }
  }

  // Time only formatting
  time(date: Date | string, includeSeconds: boolean = false): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return 'Invalid Time';
    }

    const options: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    };

    if (includeSeconds) {
      options.second = '2-digit';
    }

    return dateObj.toLocaleTimeString(this.defaultLocale, options);
  }

  // Relative time formatting (e.g., "2 hours ago")
  relativeTime(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - dateObj.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return 'Just now';
    }

    const intervals = [
      { label: 'year', seconds: 31536000 },
      { label: 'month', seconds: 2592000 },
      { label: 'week', seconds: 604800 },
      { label: 'day', seconds: 86400 },
      { label: 'hour', seconds: 3600 },
      { label: 'minute', seconds: 60 },
    ];

    for (const interval of intervals) {
      const count = Math.floor(diffInSeconds / interval.seconds);
      if (count >= 1) {
        return `${count} ${interval.label}${count > 1 ? 's' : ''} ago`;
      }
    }

    return 'Just now';
  }

  // Duration formatting (e.g., "2h 30m")
  duration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const parts: string[] = [];
    
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (remainingSeconds > 0 && hours === 0) parts.push(`${remainingSeconds}s`);

    return parts.join(' ');
  }
}