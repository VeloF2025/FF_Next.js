/**
 * Technical Details Component
 * Collapsible technical error information for debugging
 */

import { ChevronDown, ChevronUp } from 'lucide-react';
import { ErrorInfo } from 'react';

interface TechnicalDetailsProps {
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  onToggleDetails: () => void;
}

export function TechnicalDetails({ 
  error, 
  errorInfo, 
  showDetails, 
  onToggleDetails 
}: TechnicalDetailsProps) {
  return (
    <div className="border-t pt-4">
      <button
        onClick={onToggleDetails}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {showDetails ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
        Technical Details
      </button>
      
      {showDetails && errorInfo && (
        <div className="mt-4 space-y-4">
          {/* Error Type */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">
              Error Type
            </h3>
            <p className="text-sm text-muted-foreground">{error?.name}</p>
          </div>
          
          {/* Stack Trace */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">
              Stack Trace
            </h3>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
              {error?.stack}
            </pre>
          </div>
          
          {/* Component Stack */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground tracking-wide mb-2">
              Component Stack
            </h3>
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
              {errorInfo.componentStack}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}