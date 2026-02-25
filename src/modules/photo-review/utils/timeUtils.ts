import { formatDisplayDate, formatDisplayDateShort } from '@/utils/dateFormat';

/**
 * Format a date to a relative time string (e.g., "2 hours ago", "Yesterday")
 */
export function formatRelativeTime(date: string | Date | undefined): string {
    if (!date) return '';

    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay}d ago`;

    // Format as date for older items
    if (then.getFullYear() !== now.getFullYear()) {
        return formatDisplayDate(then);
    }
    return formatDisplayDateShort(then);
}

/**
 * Check if a date is within the last 24 hours
 */
export function isWithin24Hours(date: string | Date | undefined): boolean {
    if (!date) return false;

    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    return diffHours < 24;
}
