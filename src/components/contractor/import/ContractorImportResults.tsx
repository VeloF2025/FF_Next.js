/**
 * ContractorImportResults - Display import results and statistics
 */

import { CheckCircle, AlertTriangle, X, Download } from 'lucide-react';
import type { ContractorImportResult } from '@/types/contractor/import.types';

interface ContractorImportResultsProps {
  result: ContractorImportResult;
  onClose: () => void;
  onImportMore: () => void;
}

export function ContractorImportResults({
  result,
  onClose,
  onImportMore
}: ContractorImportResultsProps) {
  const hasErrors = result.errors.length > 0;
  const successRate = (result.totalProcessed ?? 0) > 0 
    ? Math.round(((result.successCount ?? 0) / (result.totalProcessed ?? 0)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Success/Error Summary */}
      <div className="text-center">
        {hasErrors ? (
          <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
        ) : (
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
        )}
        <h3 className="text-lg font-semibold text-foreground">
          {hasErrors ? 'Import Completed with Issues' : 'Import Successful!'}
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          {result.successCount} of {result.totalProcessed} contractors imported successfully ({successRate}%)
        </p>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{result.successCount}</div>
          <div className="text-xs text-green-800">Successful</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-600">{result.errors.length}</div>
          <div className="text-xs text-red-800">Errors</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{result.duplicatesSkipped}</div>
          <div className="text-xs text-yellow-800">Duplicates</div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{result.totalProcessed}</div>
          <div className="text-xs text-blue-800">Total</div>
        </div>
      </div>

      {/* Error Details */}
      {hasErrors && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-red-900 mb-3">
            Import Errors ({result.errors.length})
          </h4>
          <div className="max-h-32 overflow-y-auto space-y-2">
            {result.errors.slice(0, 5).map((error, index) => (
              <div key={index} className="text-sm text-red-700 flex items-start">
                <X className="w-4 h-4 text-red-500 mt-0.5 mr-2 flex-shrink-0" />
                <span>Row {error.row}: {error.message}</span>
              </div>
            ))}
            {result.errors.length > 5 && (
              <div className="text-xs text-red-600 font-medium">
                ... and {result.errors.length - 5} more errors
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success Details */}
      {(result.successCount ?? 0) > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-green-900 mb-2">
            Successfully Imported Contractors
          </h4>
          <p className="text-sm text-green-700">
            {result.successCount} contractors have been added to your system and are now available in the contractors dashboard.
          </p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div className="flex space-x-3">
          {hasErrors && (
            <button
              onClick={() => {/* Download error report */}}
              className="inline-flex items-center px-3 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100"
            >
              <Download className="w-4 h-4 mr-1" />
              Download Error Report
            </button>
          )}
        </div>
        
        <div className="flex space-x-3">
          <button
            onClick={onImportMore}
            className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-background"
          >
            Import More
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}