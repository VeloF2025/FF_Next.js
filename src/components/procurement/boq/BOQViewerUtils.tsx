/**
 * Utility functions for BOQ Viewer components
 */

import { CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { BOQItem } from '@/types/procurement/boq.types';
import { VisibleColumns } from './BOQViewerTypes';
import { notificationService } from '@/services/core/NotificationService';

/**
 * Get status badge styling
 */
export const getStatusBadge = (status: string, type: 'mapping' | 'procurement') => {
  const baseClasses = "px-2 py-1 rounded-full text-xs font-medium";

  if (type === 'mapping') {
    switch (status) {
      case 'mapped':
        return `${baseClasses} bg-green-500/20 text-green-400`;
      case 'pending':
        return `${baseClasses} bg-yellow-500/20 text-yellow-400`;
      case 'manual':
        return `${baseClasses} bg-blue-500/20 text-blue-400`;
      case 'exception':
        return `${baseClasses} bg-red-500/20 text-red-400`;
      default:
        return `${baseClasses} bg-gray-500/20 text-gray-400`;
    }
  } else {
    switch (status) {
      case 'pending':
        return `${baseClasses} bg-gray-500/20 text-gray-400`;
      case 'rfq_created':
        return `${baseClasses} bg-blue-500/20 text-blue-400`;
      case 'quoted':
        return `${baseClasses} bg-yellow-500/20 text-yellow-400`;
      case 'awarded':
        return `${baseClasses} bg-green-500/20 text-green-400`;
      case 'ordered':
        return `${baseClasses} bg-purple-500/20 text-purple-400`;
      default:
        return `${baseClasses} bg-gray-500/20 text-gray-400`;
    }
  }
};

/**
 * Get confidence indicator component
 */
export const getConfidenceIndicator = (confidence?: number) => {
  if (!confidence) return null;
  
  if (confidence >= 90) {
    return <CheckCircle className="h-4 w-4 text-green-500" />;
  } else if (confidence >= 70) {
    return <Clock className="h-4 w-4 text-yellow-500" />;
  } else {
    return <AlertTriangle className="h-4 w-4 text-red-500" />;
  }
};

/**
 * Export BOQ data to CSV
 */
export const exportBOQToCSV = (
  boqData: { fileName?: string },
  filteredItems: BOQItem[],
  visibleColumns: VisibleColumns
) => {
  try {
    // Create CSV content
    const headers = Object.keys(visibleColumns)
      .filter(key => visibleColumns[key as keyof typeof visibleColumns])
      .map(key => key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'));

    const csvContent = [
      headers.join(','),
      ...filteredItems.map(item => 
        Object.keys(visibleColumns)
          .filter(key => visibleColumns[key as keyof typeof visibleColumns])
          .map(key => {
            const value = item[key as keyof BOQItem];
            return typeof value === 'string' ? `"${value}"` : value || '';
          })
          .join(',')
      )
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${boqData.fileName || 'boq'}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    notificationService.operationSuccess('exported', 'BOQ');
  } catch (error) {
    // log.error('Failed to export BOQ:', { data: error }, 'BOQViewerUtils');
    notificationService.operationError('export', error as Error, 'BOQ');
  }
};