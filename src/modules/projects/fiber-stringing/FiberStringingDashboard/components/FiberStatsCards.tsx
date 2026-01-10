import { Cable, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { FiberStats } from '../types/fiberStringing.types';

interface FiberStatsCardsProps {
  stats: FiberStats;
}

export function FiberStatsCards({ stats }: FiberStatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-primary-100 rounded-lg">
            <Cable className="h-5 w-5 text-primary-600" />
          </div>
          <span className="text-sm text-[var(--ff-text-secondary)]">Total Sections</span>
        </div>
        <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{stats.sectionsTotal}</p>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          {stats.totalDistance}m total distance
        </p>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-success-500/20 rounded-lg">
            <CheckCircle className="h-5 w-5 text-success-600" />
          </div>
          <span className="text-sm text-[var(--ff-text-secondary)]">Completed</span>
        </div>
        <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{stats.sectionsCompleted}</p>
        <p className="text-sm text-success-600 mt-1">
          {stats.completedDistance}m installed
        </p>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-info-500/20 rounded-lg">
            <Clock className="h-5 w-5 text-info-600" />
          </div>
          <span className="text-sm text-[var(--ff-text-secondary)]">In Progress</span>
        </div>
        <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">{stats.sectionsInProgress}</p>
        <p className="text-sm text-info-600 mt-1">Active installations</p>
      </div>

      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-warning-500/20 rounded-lg">
            <TrendingUp className="h-5 w-5 text-warning-600" />
          </div>
          <span className="text-sm text-[var(--ff-text-secondary)]">Avg Speed</span>
        </div>
        <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
          {stats.averageSpeed.toFixed(0)}m/day
        </p>
        <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
          Est. completion: {stats.estimatedCompletion}
        </p>
      </div>
    </div>
  );
}