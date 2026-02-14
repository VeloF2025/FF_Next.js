/**
 * BOQ Mapping Batch Actions Component
 */

import { CheckCircle, X, RefreshCw } from 'lucide-react';

interface BOQMappingBatchActionsProps {
  selectedCount: number;
  isProcessing: boolean;
  onBatchApprove: () => void;
  onBatchDismiss: () => void;
  onClearSelection: () => void;
  onRefresh: () => void;
}

export default function BOQMappingBatchActions({
  selectedCount,
  isProcessing,
  onBatchApprove,
  onBatchDismiss,
  onClearSelection,
  onRefresh
}: BOQMappingBatchActionsProps) {
  if (selectedCount === 0) {
    return (
      <div className="flex items-center justify-between p-4 bg-background rounded-lg">
        <p className="text-sm text-muted-foreground">
          Select exceptions to perform batch actions
        </p>
        <button
          onClick={onRefresh}
          disabled={isProcessing}
          className="px-3 py-1.5 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-4 bg-blue-50 rounded-lg">
      <div className="flex items-center space-x-4">
        <span className="text-sm font-medium text-blue-900">
          {selectedCount} exception{selectedCount !== 1 ? 's' : ''} selected
        </span>
        <button
          onClick={onClearSelection}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Clear selection
        </button>
      </div>
      
      <div className="flex items-center space-x-3">
        <button
          onClick={onBatchDismiss}
          disabled={isProcessing}
          className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-border rounded-md hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          <X className="h-4 w-4 mr-2" />
          Dismiss Selected
        </button>
        <button
          onClick={onBatchApprove}
          disabled={isProcessing}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Approve Best Matches
        </button>
      </div>
    </div>
  );
}