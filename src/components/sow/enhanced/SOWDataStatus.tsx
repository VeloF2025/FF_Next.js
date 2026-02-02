/**
 * SOW Data Status Component
 * Displays metadata about SOW data import
 */

import { CheckCircle, Database, Clock, Hash, Activity } from 'lucide-react';

interface SOWDataStatusProps {
  sowData: {
    data?: {
      summary?: {
        totalPoles?: number;
        totalDrops?: number;
        totalFibre?: number;
        lastImported?: string;
        dataSource?: string;
      };
    };
  } | null;
  polesCount: number;
  dropsCount: number;
  fibreCount: number;
}

export function SOWDataStatus({
  sowData,
  polesCount,
  dropsCount,
  fibreCount
}: SOWDataStatusProps) {
  const summary = sowData?.data?.summary;
  const totalItems = (summary?.totalPoles ?? polesCount) +
                     (summary?.totalDrops ?? dropsCount) +
                     (summary?.totalFibre ?? fibreCount);

  // Format last imported date
  const lastImported = summary?.lastImported
    ? new Date(summary.lastImported).toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Not yet imported';

  return (
    <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
      <h4 className="font-medium text-[var(--ff-text-primary)] mb-3">Data Status</h4>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">Source:</span>
          <span className="ml-1 font-medium">{summary?.dataSource || 'PostgreSQL'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">Last Updated:</span>
          <span className="ml-1 font-medium">{lastImported}</span>
        </div>
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">Total Items:</span>
          <span className="ml-1 font-medium">{totalItems.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <span className="text-[var(--ff-text-secondary)]">Status:</span>
          <span className="ml-1 font-medium text-green-500 flex items-center gap-1">
            <CheckCircle className="w-4 h-4" />
            Active
          </span>
        </div>
      </div>
    </div>
  );
}