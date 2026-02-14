/**
 * BOQ Exception Card Component
 */

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, SkipForward } from 'lucide-react';
import { ExceptionWithItem, SEVERITY_COLORS, EXCEPTION_TYPE_LABELS } from './BOQMappingTypes';
import BOQMappingSuggestions from './BOQMappingSuggestions';

interface BOQExceptionCardProps {
  exception: ExceptionWithItem;
  isExpanded: boolean;
  isSelected: boolean;
  isProcessing: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onApproveMapping: (suggestionIndex: number) => void;
  onDismiss: (reason: string) => void;
}

export default function BOQExceptionCard({
  exception,
  isExpanded,
  isSelected,
  isProcessing,
  onToggleExpand,
  onToggleSelect,
  onApproveMapping,
  onDismiss
}: BOQExceptionCardProps) {
  const [dismissReason, setDismissReason] = useState('');
  const [showDismissDialog, setShowDismissDialog] = useState(false);

  const handleDismiss = () => {
    if (dismissReason.trim()) {
      onDismiss(dismissReason);
      setShowDismissDialog(false);
      setDismissReason('');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={onToggleSelect}
              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
            />
            
            <div className="flex-1">
              <div className="flex items-center space-x-2">
                <AlertTriangle className={`h-5 w-5 ${
                  exception.severity === 'high' ? 'text-red-500' :
                  exception.severity === 'medium' ? 'text-yellow-500' :
                  'text-blue-500'
                }`} />
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  Line {exception.boqItem.lineNumber}: {exception.boqItem.description}
                </span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  SEVERITY_COLORS[exception.severity]
                }`}>
                  {exception.severity}
                </span>
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">
                  {EXCEPTION_TYPE_LABELS[exception.exceptionType] || exception.exceptionType}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 dark:text-gray-400">
                <div>
                  <span className="font-medium">Item Code:</span> {exception.boqItem.itemCode || 'N/A'}
                </div>
                <div>
                  <span className="font-medium">Quantity:</span> {exception.boqItem.quantity} {exception.boqItem.uom}
                </div>
                <div>
                  <span className="font-medium">Unit Price:</span> R{exception.boqItem.unitPrice?.toFixed(2) || '0.00'}
                </div>
              </div>

              {exception.exceptionDetails && (
                <div className="mt-2 p-2 bg-yellow-50 rounded-md">
                  <p className="text-sm text-yellow-800">{exception.exceptionDetails}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 ml-4">
            <button
              onClick={() => setShowDismissDialog(true)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-400"
              title="Dismiss exception"
            >
              <SkipForward className="h-5 w-5" />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 text-gray-400 hover:text-gray-600 dark:text-gray-400"
            >
              {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700">
          <BOQMappingSuggestions
            suggestions={exception.suggestions}
            onSelectSuggestion={onApproveMapping}
            isProcessing={isProcessing}
          />
        </div>
      )}

      {showDismissDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              Dismiss Exception
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Please provide a reason for dismissing this exception:
            </p>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Enter reason..."
            />
            <div className="flex justify-end space-x-3 mt-4">
              <button
                onClick={() => setShowDismissDialog(false)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 dark:bg-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleDismiss}
                disabled={!dismissReason.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}