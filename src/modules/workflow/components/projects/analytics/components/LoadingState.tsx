/**
 * Loading State Component
 */

import { InlineSpinner } from '@/components/ui/LoadingSpinner';

export function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="flex items-center space-x-2">
        <InlineSpinner size="sm" className="text-green-600" />
        <span className="text-muted-foreground">Loading analytics...</span>
      </div>
    </div>
  );
}
