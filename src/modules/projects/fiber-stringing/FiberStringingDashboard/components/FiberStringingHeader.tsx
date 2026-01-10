import { Cable } from 'lucide-react';
import { FiberStats } from '../types/fiberStringing.types';

interface FiberStringingHeaderProps {
  stats: FiberStats;
}

export function FiberStringingHeader({ stats }: FiberStringingHeaderProps) {
  const progressPercentage = (stats.completedDistance / stats.totalDistance) * 100 || 0;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ff-text-primary)]">Fiber Stringing Progress</h1>
          <p className="text-[var(--ff-text-secondary)] mt-1">Track fiber cable installation across sections</p>
        </div>
        <div className="flex items-center gap-2">
          <Cable className="h-8 w-8 text-primary-600" />
        </div>
      </div>

      {/* Overall Progress */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">Overall Progress</span>
          <span className="text-sm font-semibold text-[var(--ff-text-primary)]">{progressPercentage.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3">
          <div
            className="bg-primary-600 h-3 rounded-full transition-all"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-xs text-[var(--ff-text-secondary)]">
          <span>{stats.completedDistance}m completed</span>
          <span>{stats.totalDistance}m total</span>
        </div>
      </div>
    </div>
  );
}