import { MapPin, Home, Cable } from 'lucide-react';

interface TrackerStatsProps {
  stats: {
    poles: {
      total: number;
      completed: number;
      progress: number;
      pending: number;
    };
    drops: {
      total: number;
      completed: number;
      progress: number;
      pending: number;
    };
    fiber: {
      total: number;
      completed: number;
      progress: number;
      pending: number;
    };
  } | null;
}

export function TrackerStats({ stats }: TrackerStatsProps) {
  if (!stats) return null;

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Poles</span>
          <MapPin className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        </div>
        <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.poles.total}</div>
        <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {stats.poles.completed} completed, {stats.poles.progress} in progress
        </div>
      </div>
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Home Drops</span>
          <Home className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        </div>
        <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.drops.total}</div>
        <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {stats.drops.completed} completed, {stats.drops.progress} in progress
        </div>
      </div>
      <div className="bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--ff-text-secondary)]">Fiber Sections</span>
          <Cable className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
        </div>
        <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.fiber.total}</div>
        <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
          {stats.fiber.completed} completed, {stats.fiber.progress} in progress
        </div>
      </div>
    </div>
  );
}