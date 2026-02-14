// ============= Message Priority Configuration =============
// Priority badge and dot color configuration

export interface PriorityConfig {
  label: string;
  color: string;
  dot: string;
}

type MessagePriorityKey = 'low' | 'medium' | 'high' | 'urgent';

export const priorityConfig: Record<MessagePriorityKey, PriorityConfig> = {
  low: { label: 'Low', color: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200', dot: 'bg-gray-400' },
  medium: { label: 'Medium', color: 'bg-blue-100 text-blue-800', dot: 'bg-blue-400' },
  high: { label: 'High', color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-400' },
  urgent: { label: 'Urgent', color: 'bg-red-100 text-red-800', dot: 'bg-red-400' }
};
