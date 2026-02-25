/**
 * WA Monitor Helper Functions
 * Utility functions for formatting, filtering, and data manipulation
 */

import { formatDistanceToNow } from 'date-fns';
import { formatDisplayDateTime, formatDisplayDate } from '@/utils/dateFormat';
import { log } from '@/lib/logger';
import type { QaReviewDrop, DropStatus } from '../types/wa-monitor.types';

// ==================== DATE FORMATTING ====================

/**
 * Format date to user-friendly string
 * Example: "Jan 6, 2025 2:30 PM"
 */
export function formatDateTime(date: Date | string | null): string {
  if (!date) return '-';

  try {
    return formatDisplayDateTime(date);
  } catch (error) {
    log.error('Error formatting date', { error, date }, 'waMonitorHelpers.formatDateTime');
    return '-';
  }
}

/**
 * Format date to relative time
 * Example: "2 hours ago", "3 days ago"
 */
export function formatRelativeTime(date: Date | string | null): string {
  if (!date) return '-';

  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  } catch (error) {
    log.error('Error formatting relative time', { error, date }, 'waMonitorHelpers.formatRelativeTime');
    return '-';
  }
}

/**
 * Format date to just the date part
 * Example: "Jan 6, 2025"
 */
export function formatDate(date: Date | string | null): string {
  if (!date) return '-';

  try {
    return formatDisplayDate(date);
  } catch (error) {
    log.error('Error formatting date', { error, date }, 'waMonitorHelpers.formatDate');
    return '-';
  }
}

// ==================== DATA FILTERING ====================

/**
 * Filter drops by search term (searches drop number)
 */
export function filterDropsBySearch(drops: QaReviewDrop[], searchTerm: string): QaReviewDrop[] {
  if (!searchTerm) return drops;

  const term = searchTerm.toLowerCase().trim();
  return drops.filter(drop =>
    drop.dropNumber.toLowerCase().includes(term)
  );
}

/**
 * Filter drops by status
 */
export function filterDropsByStatus(drops: QaReviewDrop[], statuses: DropStatus[]): QaReviewDrop[] {
  if (!statuses || statuses.length === 0) return drops;

  return drops.filter(drop => statuses.includes(drop.status));
}

/**
 * Filter drops by date range
 */
export function filterDropsByDateRange(
  drops: QaReviewDrop[],
  startDate: Date | null,
  endDate: Date | null
): QaReviewDrop[] {
  if (!startDate && !endDate) return drops;

  return drops.filter(drop => {
    const createdAt = new Date(drop.createdAt);

    if (startDate && createdAt < startDate) return false;
    if (endDate && createdAt > endDate) return false;

    return true;
  });
}

// ==================== DATA SORTING ====================

/**
 * Sort drops by field and direction
 */
export function sortDrops(
  drops: QaReviewDrop[],
  field: keyof QaReviewDrop,
  order: 'asc' | 'desc'
): QaReviewDrop[] {
  const sorted = [...drops].sort((a, b) => {
    const aValue = a[field];
    const bValue = b[field];

    // Handle null values
    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return order === 'asc' ? 1 : -1;
    if (bValue === null) return order === 'asc' ? -1 : 1;

    // Handle dates
    if (aValue instanceof Date && bValue instanceof Date) {
      return order === 'asc'
        ? aValue.getTime() - bValue.getTime()
        : bValue.getTime() - aValue.getTime();
    }

    // Handle numbers
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return order === 'asc' ? aValue - bValue : bValue - aValue;
    }

    // Handle strings
    const aStr = String(aValue).toLowerCase();
    const bStr = String(bValue).toLowerCase();

    if (order === 'asc') {
      return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
    } else {
      return aStr > bStr ? -1 : aStr < bStr ? 1 : 0;
    }
  });

  return sorted;
}

// ==================== EXPORT HELPERS ====================

/**
 * Convert drops to CSV format with QA checklist steps
 */
export function convertDropsToCSV(drops: QaReviewDrop[]): string {
  const headers = [
    'Drop Number',
    'Project',
    'Status',
    'User Name',
    'Created At',
    'Updated At',
    'Resubmitted',
    'Feedback Sent',
    'Step 1: House Photo',
    'Step 2: Cable from Pole',
    'Step 3: Cable Entry (Outside)',
    'Step 4: Cable Entry (Inside)',
    'Step 5: Wall for Installation',
    'Step 6: ONT Back After Install',
    'Step 7: Power Meter Reading',
    'Step 8: ONT Barcode',
    'Step 9: UPS Serial',
    'Step 10: Final Installation',
    'Step 11: Green Lights',
    'Step 12: Customer Signature',
    'Comment'
  ];

  const rows = drops.map(drop => [
    drop.dropNumber,
    drop.project || '',
    drop.status,
    drop.userName || '',
    formatDateTime(drop.createdAt),
    formatDateTime(drop.updatedAt),
    drop.resubmitted ? 'Yes' : 'No',
    drop.feedbackSent ? formatDateTime(drop.feedbackSent) : 'Not Sent',
    drop.step_01_house_photo ? 'OK' : 'MISSING',
    drop.step_02_cable_from_pole ? 'OK' : 'MISSING',
    drop.step_03_cable_entry_outside ? 'OK' : 'MISSING',
    drop.step_04_cable_entry_inside ? 'OK' : 'MISSING',
    drop.step_05_wall_for_installation ? 'OK' : 'MISSING',
    drop.step_06_ont_back_after_install ? 'OK' : 'MISSING',
    drop.step_07_power_meter_reading ? 'OK' : 'MISSING',
    drop.step_08_ont_barcode ? 'OK' : 'MISSING',
    drop.step_09_ups_serial ? 'OK' : 'MISSING',
    drop.step_10_final_installation ? 'OK' : 'MISSING',
    drop.step_11_green_lights ? 'OK' : 'MISSING',
    drop.step_12_customer_signature ? 'OK' : 'MISSING',
    drop.comment || ''
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Download CSV file
 */
export function downloadCSV(drops: QaReviewDrop[], filename = 'wa-monitor-drops.csv'): void {
  const csv = convertDropsToCSV(drops);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');

  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==================== STATUS HELPERS ====================

/**
 * Get status color class for Tailwind
 */
export function getStatusColorClass(status: DropStatus): string {
  return status === 'complete' ? 'text-green-600' : 'text-red-600';
}

/**
 * Get status background color class for Tailwind
 */
export function getStatusBgClass(status: DropStatus): string {
  return status === 'complete' ? 'bg-green-50' : 'bg-red-50';
}

// ==================== VALIDATION ====================

/**
 * Validate drop number format (DR########)
 */
export function isValidDropNumber(dropNumber: string): boolean {
  return /^DR\d{8}$/.test(dropNumber);
}

/**
 * Parse drop number to extract parts
 * Example: "DR12345678" -> { prefix: "DR", number: "12345678" }
 */
export function parseDropNumber(dropNumber: string): { prefix: string; number: string } | null {
  const match = dropNumber.match(/^(DR)(\d{8})$/);

  if (!match) return null;

  return {
    prefix: match[1],
    number: match[2]
  };
}
