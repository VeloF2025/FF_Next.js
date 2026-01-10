/**
 * SOW Empty State Component
 */

import { Database, Upload } from 'lucide-react';

interface SOWEmptyStateProps {
  onImportClick: () => void;
}

export function SOWEmptyState({ onImportClick }: SOWEmptyStateProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-8">
      <div className="text-center">
        <Database className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No SOW Data Found</h3>
        <p className="text-[var(--ff-text-secondary)] mb-6">
          This project doesn't have any Scope of Work data yet.
        </p>
        
        <button
          onClick={onImportClick}
          className="inline-flex items-center px-6 py-3 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <Upload className="w-4 h-4 mr-2" />
          Import SOW Data
        </button>
        
        <div className="mt-4">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            Upload Excel files containing poles, drops, and fibre scope data
          </p>
        </div>
      </div>
    </div>
  );
}