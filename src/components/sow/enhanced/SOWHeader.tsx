/**
 * SOW Header Component
 * View-only header - data upload is done via Documents tab
 */

import { Database } from 'lucide-react';

interface SOWHeaderProps {
  hasData: boolean;
}

export function SOWHeader({ hasData }: SOWHeaderProps) {
  return (
    <div className="p-6 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <Database className="h-6 w-6 text-primary-600 mr-3" />
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Scope of Work Data</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {hasData ? 'View SOW data for this project' : 'No SOW data imported yet'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}