/**
 * SOW Empty State Component
 * View-only - directs users to Documents tab for imports
 */

import { Database, FileText } from 'lucide-react';

export function SOWEmptyState() {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-8">
      <div className="text-center">
        <Database className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">No SOW Data Found</h3>
        <p className="text-[var(--ff-text-secondary)] mb-4">
          This project doesn&apos;t have any Scope of Work data yet.
        </p>

        <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 text-blue-400 rounded-lg text-sm">
          <FileText className="w-4 h-4" />
          Import SOW data via the Finance → Documents tab
        </div>
      </div>
    </div>
  );
}