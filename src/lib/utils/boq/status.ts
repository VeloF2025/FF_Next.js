/**
 * BOQ Status Display Utilities
 * Helper functions for status display information
 */

import { BOQStatus, BOQItemMappingStatusType, ProcurementStatusType } from '@/types/procurement/boq.types';
import { StatusDisplayInfo } from './types';

/**
 * Get BOQ status display information
 */
export function getBOQStatusInfo(status: BOQStatus): StatusDisplayInfo {
  const statusMap: Record<BOQStatus, StatusDisplayInfo> = {
    'draft': {
      label: 'Draft',
      color: 'gray',
      bgColor: 'bg-secondary',
      textColor: 'text-foreground',
      borderColor: 'border-border'
    },
    'mapping_review': {
      label: 'Mapping Review',
      color: 'yellow',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800',
      borderColor: 'border-yellow-200'
    },
    'approved': {
      label: 'Approved',
      color: 'green',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      borderColor: 'border-green-200'
    },
    'archived': {
      label: 'Archived',
      color: 'purple',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-800',
      borderColor: 'border-purple-200'
    }
  };

  return statusMap[status] || statusMap['draft'];
}

/**
 * Get mapping status display information
 */
export function getMappingStatusInfo(status: BOQItemMappingStatusType): StatusDisplayInfo {
  const statusMap: Record<BOQItemMappingStatusType, StatusDisplayInfo> = {
    'pending': {
      label: 'Pending',
      color: 'gray',
      bgColor: 'bg-secondary',
      textColor: 'text-foreground',
      icon: '⏳'
    },
    'mapped': {
      label: 'Mapped',
      color: 'green',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      icon: '✅'
    },
    'manual': {
      label: 'Manual',
      color: 'blue',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-800',
      icon: '👤'
    },
    'exception': {
      label: 'Exception',
      color: 'red',
      bgColor: 'bg-red-100',
      textColor: 'text-red-800',
      icon: '⚠️'
    }
  };

  return statusMap[status] || statusMap['pending'];
}

/**
 * Get procurement status display information
 */
export function getProcurementStatusInfo(status: ProcurementStatusType): StatusDisplayInfo {
  const statusMap: Record<ProcurementStatusType, StatusDisplayInfo> = {
    'pending': {
      label: 'Pending',
      color: 'gray',
      bgColor: 'bg-secondary',
      textColor: 'text-foreground',
      icon: '📋'
    },
    'rfq_created': {
      label: 'RFQ Created',
      color: 'blue',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-800',
      icon: '📝'
    },
    'quoted': {
      label: 'Quoted',
      color: 'yellow',
      bgColor: 'bg-yellow-100',
      textColor: 'text-yellow-800',
      icon: '💰'
    },
    'awarded': {
      label: 'Awarded',
      color: 'green',
      bgColor: 'bg-green-100',
      textColor: 'text-green-800',
      icon: '🏆'
    },
    'ordered': {
      label: 'Ordered',
      color: 'purple',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-800',
      icon: '📦'
    }
  };

  return statusMap[status] || statusMap['pending'];
}