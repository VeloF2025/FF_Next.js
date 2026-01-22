/**
 * Project Detail Utility Functions
 * Common formatting and utility functions for project details
 */

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
  if (!timestamp) return 'N/A';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('en-ZA', { 
    day: 'numeric', 
    month: 'short', 
    year: 'numeric' 
  });
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
  return projectType ? projectType.toUpperCase() : 'STANDARD';
};

/**
 * Calculate percentage from progress value
 */
export const calculatePercentage = (progress: number): number => {
  return Math.round(progress || 0);
};

/**
 * Get tab configuration
 */
export const getTabConfig = () => [
  { id: 'overview', label: 'Overview' },
  { id: 'hierarchy', label: 'Project Hierarchy' },
  { id: 'sow', label: 'SOW Data' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'budget', label: 'Budget' },
  { id: 'hs', label: 'Health & Safety' },
];