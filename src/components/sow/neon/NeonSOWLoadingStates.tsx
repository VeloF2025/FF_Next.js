/**
 * Neon SOW Loading and Error States
 */

import { AlertCircle, Database } from 'lucide-react';
import { NeonHealthData } from './NeonSOWTypes';

export function NeonSOWLoadingState() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      <span className="ml-3 text-[var(--ff-text-secondary)]">Loading SOW data from Neon...</span>
    </div>
  );
}

interface NeonSOWErrorStateProps {
  error?: string;
  sowData?: { error?: string } | null;
  neonHealth?: NeonHealthData;
  neonConnected?: boolean;
}

export function NeonSOWErrorState({ error, sowData, neonHealth, neonConnected }: NeonSOWErrorStateProps) {
  return (
    <div className="p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center">
          <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
          <div>
            <h3 className="text-red-800 font-medium">Failed to Load SOW Data</h3>
            <p className="text-red-700 text-sm mt-1">
              {sowData?.error || error || 'Unknown error accessing Neon database'}
            </p>
            {(!neonHealth?.connected || !neonConnected) && (
              <p className="text-red-600 text-xs mt-2">
                Database connection issue. Check your Neon configuration.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function NeonSOWEmptyState() {
  return (
    <div className="p-8 text-center">
      <Database className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
      <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No SOW Data Found</h3>
      <p className="text-[var(--ff-text-secondary)] mb-4">
        This project doesn't have any Scope of Work data in the Neon database yet.
      </p>
      <div className="text-sm text-[var(--ff-text-tertiary)] space-y-1">
        <p>To import SOW data, use the import scripts:</p>
        <code className="bg-[var(--ff-bg-tertiary)] px-2 py-1 rounded text-xs">
          node scripts/sow-import/import-sow-to-neon.js
        </code>
      </div>
    </div>
  );
}