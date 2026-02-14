/**
 * Error Display Component
 * Displays error information with suggested actions
 */

import { AlertTriangle } from 'lucide-react';
import { ErrorDetails } from '../types/errorBoundary.types';

interface ErrorDisplayProps {
  errorDetails: ErrorDetails;
  error: Error | null;
  isComponentLevel: boolean;
}

export function ErrorDisplay({ errorDetails, error /* isComponentLevel */ }: ErrorDisplayProps) {
  return (
    <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-8">
      {/* Error Icon and Title */}
      <div className="flex items-center justify-center mb-6">
        <div className="bg-red-100 rounded-full p-3">
          <AlertTriangle className="h-12 w-12 text-red-600" />
        </div>
      </div>
      
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 text-center mb-2">
        {errorDetails.title}
      </h1>
      
      <p className="text-gray-600 dark:text-gray-400 text-center mb-6">
        {errorDetails.message}
      </p>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-mono text-red-800">
            {error.message || 'An unexpected error occurred'}
          </p>
        </div>
      )}

      {/* Suggestions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="text-sm font-medium text-blue-800 mb-2">Suggested Actions:</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          {errorDetails.suggestions.map((suggestion, index) => (
            <li key={index} className="flex items-start">
              <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 mr-2 flex-shrink-0"></span>
              {suggestion}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}