/**
 * SOW Header Component
 */

import { Database, Plus } from 'lucide-react';

interface SOWHeaderProps {
  hasData: boolean;
  onUpdateClick: () => void;
}

export function SOWHeader({ hasData, onUpdateClick }: SOWHeaderProps) {
  return (
    <div className="p-6 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Database className="h-6 w-6 text-primary-600 mr-3" />
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Scope of Work Data</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">Project SOW data management</p>
          </div>
        </div>
        
        {hasData && (
          <button
            onClick={onUpdateClick}
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Update Data
          </button>
        )}
      </div>
    </div>
  );
}