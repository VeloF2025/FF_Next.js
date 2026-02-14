/**
 * BOQ Dashboard Utilities
 * Helper functions for the BOQ Dashboard component
 */

import { BOQStatusType } from '@/types/procurement/boq.types';

/**
 * Get color classes for BOQ status indicators
 */
export function getStatusColor(status: BOQStatusType): string {
  switch (status) {
    case 'approved':
      return 'text-green-600 bg-green-100';
    case 'mapping_review':
      return 'text-yellow-600 bg-yellow-100';
    case 'draft':
      return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800';
    case 'archived':
      return 'text-purple-600 bg-purple-100';
    default:
      return 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800';
  }
}

/**
 * Format date to relative time string
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toISOString().split('T')[0];
}