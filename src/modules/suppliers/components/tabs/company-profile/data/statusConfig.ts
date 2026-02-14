// ============= Status Configuration =============
// Status badge configuration for supplier status display

import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  type LucideIcon
} from 'lucide-react';

export interface StatusConfig {
  icon: LucideIcon;
  color: string;
  bgColor: string;
  label: string;
}

type SupplierStatus = 'active' | 'inactive' | 'pending' | 'suspended';

export const statusConfig: Record<SupplierStatus, StatusConfig> = {
  active: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: 'Active'
  },
  inactive: {
    icon: XCircle,
    color: 'text-gray-600 dark:text-gray-400',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    label: 'Inactive'
  },
  pending: {
    icon: Clock,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: 'Pending'
  },
  suspended: {
    icon: AlertCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    label: 'Suspended'
  }
};

// Helper function to get status config with fallback
export const getStatusConfig = (status: string): StatusConfig => {
  return statusConfig[status as SupplierStatus] || statusConfig.active;
};
