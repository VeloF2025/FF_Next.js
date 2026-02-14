/**
 * Error State Component
 */

import { AlertTriangle } from 'lucide-react';

interface ErrorStateProps {
  error: string | null;
  onRetry: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      <AlertTriangle className="w-12 h-12 text-red-600 mb-4" />
      <h3 className="text-lg font-medium text-foreground mb-2">
        Analytics Unavailable
      </h3>
      <p className="text-muted-foreground text-center mb-4">
        {error || 'Unable to load workflow analytics data'}
      </p>
      <button
        onClick={onRetry}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
