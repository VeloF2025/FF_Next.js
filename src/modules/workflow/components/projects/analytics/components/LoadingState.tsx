/**
 * Loading State Component
 */

import { RefreshCw } from 'lucide-react';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center space-x-2">
        <RefreshCw className="w-5 h-5 animate-spin text-green-600" />
        <span className="text-muted-foreground">Loading analytics...</span>
      </div>
    </div>
  );
}
