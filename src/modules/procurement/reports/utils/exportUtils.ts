import { log } from '@/lib/logger';

/**
 * Export utilities for procurement reports
 */

export interface ExportOptions {
  format: 'pdf' | 'excel' | 'csv';
  filename?: string;
  includeCharts?: boolean;
  sections?: string[];
}

// 🟢 WORKING: CSV export utility
export function exportToCSV(data: any[], headers: string[], filename: string = 'report'): void {
  try {
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header] || '';
          // Escape values that contain commas or quotes
          return typeof value === 'string' && (value.includes(',') || value.includes('"'))
            ? `"${value.replace(/"/g, '""')}"`
            : value;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    log.error('Error exporting to CSV:', { data: error }, 'exportUtils');
    throw new Error('Failed to export CSV file');
  }
}

// 🔴 INCOMPLETE: PDF export - requires additional library (jsPDF)
export function exportToPDF(_data: any, filename: string = 'report'): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // TODO: Implement PDF export using jsPDF or similar library
      log.warn('PDF export not yet implemented', undefined, 'exportUtils');
      alert(`PDF export for ${filename} would be generated here`);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// 🔴 INCOMPLETE: Excel export - requires additional library (xlsx)
export function exportToExcel(_data: any, filename: string = 'report'): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // TODO: Implement Excel export using xlsx library
      log.warn('Excel export not yet implemented', undefined, 'exportUtils');
      alert(`Excel export for ${filename} would be generated here`);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

// 🟢 WORKING: Main export function
export async function exportReport(
  reportType: string,
  data: any,
  options: ExportOptions
): Promise<void> {
  const filename = options.filename || `${reportType}-${Date.now()}`;
  
  try {
    switch (options.format) {
      case 'csv':
        // Handle different report types for CSV
        if (reportType === 'supplier-performance' && data.topPerformers) {
          const headers = ['name', 'rating', 'totalSpend', 'performanceScore', 'onTimeDelivery', 'qualityScore'];
          exportToCSV(data.topPerformers, headers, filename);
        } else if (reportType === 'cost-savings' && data.categoryBreakdown) {
          const headers = ['category', 'budgeted', 'actual', 'variance', 'variancePercentage'];
          exportToCSV(data.categoryBreakdown, headers, filename);
        } else {
          throw new Error(`CSV export not supported for ${reportType}`);
        }
        break;
        
      case 'pdf':
        await exportToPDF(data, filename);
        break;
        
      case 'excel':
        await exportToExcel(data, filename);
        break;
        
      default:
        throw new Error(`Export format ${options.format} not supported`);
    }
  } catch (error) {
    log.error('Export failed:', { data: error }, 'exportUtils');
    throw error;
  }
}

// 🟢 WORKING: Format data for display
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(date: Date): string {
  // Standard YYYY-MM-DD format
  return date.toISOString().split('T')[0];
}