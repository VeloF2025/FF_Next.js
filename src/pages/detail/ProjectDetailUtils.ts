/**
 * Project Detail Utility Functions
 * Common formatting and utility functions for project details
 */

import { formatDisplayDate } from '@/utils/dateFormat';

/**
 * Format currency value to South African Rand
 */
export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR'
  }).format(amount);
};

/**
 * Format date from timestamp to localized string
 */
export const formatDate = (timestamp: any): string => {
  return formatDisplayDate(timestamp);
};

/**
 * Format project status for display
 */
export const formatStatus = (status: string): string => {
  if (!status) return 'Unknown';
  return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
};

/**
 * Format priority for display
 */
export const formatPriority = (priority: string): string => {
  if (!priority) return 'No Priority';
  return priority.charAt(0).toUpperCase() + priority.slice(1) + ' Priority';
};

/**
 * Format project type for display
 */
export const formatProjectType = (projectType: string): string => {
  if (!projectType) return 'Standard';
  return projectType.charAt(0).toUpperCase() + projectType.slice(1).toLowerCase();
};

/**
 * Calculate percentage from progress value
 */
export const calculatePercentage = (progress: number): number => {
  return Math.round(progress || 0);
};

/**
 * Tab configuration type
 */
export interface TabConfig {
  id: string;
  label: string;
  icon?: string;
  badge?: number;
}

/**
 * Grouped tab configuration for Project Detail
 * Groups: Overview, Work, Contracts, Planning, Operations, Finance
 */
export interface TabGroup {
  id: string;
  label: string;
  tabs: TabConfig[];
}

/**
 * Get flat tab configuration (legacy support)
 * Sprint 1: Added Team, Procurement, Maintenance tabs
 */
export const getTabConfig = (): TabConfig[] => [
  { id: 'overview', label: 'Overview' },
  { id: 'team', label: 'Team' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'hierarchy', label: 'Hierarchy' },
  { id: 'sow', label: 'SOW Data' },
  { id: 'agreements', label: 'Agreements' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'finance-dashboard', label: 'Finance Dashboard' },
  { id: 'income', label: 'Income' },
  { id: 'budget', label: 'Budget' },
  { id: 'hs', label: 'Health & Safety' },
];

/**
 * Get grouped tab configuration for Project Detail
 * Organizes tabs into logical groups for better navigation
 */
export const getGroupedTabConfig = (): TabGroup[] => [
  {
    id: 'overview',
    label: 'Overview',
    tabs: [{ id: 'overview', label: 'Overview' }],
  },
  {
    id: 'work',
    label: 'Work',
    tabs: [
      { id: 'sow', label: 'SOW/Contractors' },
      { id: 'boq', label: 'BOQ/Materials' },
      { id: 'team', label: 'Team' },
    ],
  },
  {
    id: 'contracts',
    label: 'Contracts',
    tabs: [
      { id: 'agreements', label: 'Agreements' },
      { id: 'wayleaves', label: 'Wayleaves' },
    ],
  },
  {
    id: 'planning',
    label: 'Planning',
    tabs: [
      { id: 'prereqs', label: 'Pre-Reqs' },
      { id: 'timeline', label: 'Timeline' },
      { id: 'hierarchy', label: 'Hierarchy' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    tabs: [
      { id: 'pon-stages', label: 'Tracker' },
      { id: 'pon-progress', label: 'Progress' },
      { id: 'sp-tracker', label: 'SP Data' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    tabs: [
      { id: 'procurement', label: 'Procurement' },
      { id: 'maintenance', label: 'Maintenance' },
      { id: 'hs', label: 'Health & Safety' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    tabs: [
      { id: 'finance-dashboard', label: 'Dashboard' },
      { id: 'income', label: 'Income' },
      { id: 'budget', label: 'Budget' },
      { id: 'documents', label: 'Documents' },
    ],
  },
];