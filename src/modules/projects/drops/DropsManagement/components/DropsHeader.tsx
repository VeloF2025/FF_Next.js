
import { Home } from 'lucide-react';
import type { DropsStats } from '../types/drops.types';

interface DropsHeaderProps {
  stats: DropsStats;
}

export function DropsHeader({ stats }: DropsHeaderProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Drops Management</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Track and manage customer drop installations</p>
        </div>
        <div className="flex items-center gap-2">
          <Home className="h-8 w-8 text-primary-600" />
        </div>
      </div>

      {/* Progress Overview */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">Completion Rate</span>
          <span className="text-sm font-semibold text-[var(--ff-text-primary)]">{stats.completionRate.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3">
          <div
            className="bg-success-600 h-3 rounded-full transition-all"
            style={{ width: `${stats.completionRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}