/**
 * Project Formatters
 * Utility functions for formatting project data
 */

import { formatDisplayDate } from '@/utils/dateFormat';

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR'
  }).format(amount);
};

export const formatDate = (timestamp: any): string => {
  return formatDisplayDate(timestamp);
};

export const formatProjectStatus = (status: string): string => {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
};

export const formatProjectType = (type: string): string => {
  if (!type) return 'GENERAL';
  return type.toUpperCase();
};

export const formatPriority = (priority: string): string => {
  if (!priority) return 'Normal';
  return priority.charAt(0).toUpperCase() + priority.slice(1);
};

export const formatProgressPercentage = (progress: number | undefined): number => {
  return Math.round(progress || 0);
};