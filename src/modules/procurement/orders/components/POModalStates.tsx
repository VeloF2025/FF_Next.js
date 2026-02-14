// ============= PO Modal States Component =============
// Loading and error states for PO detail modal

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { VelocityButton, LoadingSpinner } from '../../../../components/ui';

interface LoadingStateProps {}

export const LoadingState: React.FC<LoadingStateProps> = () => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8">
        <LoadingSpinner size="lg" />
      </div>
    </div>
  );
};

interface ErrorStateProps {
  error: string;
  onClose: () => void;
  onRetry: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  error,
  onClose,
  onRetry
}) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-8 max-w-md">
        <div className="text-center">
          <AlertCircle className="h-12 w-12 text-red-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-red-800 mb-2">Error</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <div className="flex space-x-3">
            <VelocityButton variant="outline" onClick={onClose}>
              Close
            </VelocityButton>
            <VelocityButton onClick={onRetry}>Try Again</VelocityButton>
          </div>
        </div>
      </div>
    </div>
  );
};
