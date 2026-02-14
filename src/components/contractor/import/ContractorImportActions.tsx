/**
 * Contractor Import Actions Component
 * Action buttons for template download and export
 */

/**
 * @fileoverview ContractorImportActions component
 */
import { Download, Upload } from 'lucide-react';
import { ContractorImportActionsProps } from './ContractorImportTypes';

export function ContractorImportActions({ 
  onDownloadTemplate, 
  onExportAll 
}: ContractorImportActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={onDownloadTemplate}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
        title="Download CSV template with sample data and all available fields"
      >
        <Download className="h-4 w-4" />
        Download Template
      </button>
      
      <button
        onClick={onExportAll}
        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:bg-gray-900 transition-colors"
        title="Export all existing contractors to Excel file"
      >
        <Upload className="h-4 w-4" />
        Export All Contractors
      </button>
    </div>
  );
}