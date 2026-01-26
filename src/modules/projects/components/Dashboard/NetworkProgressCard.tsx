/**
 * Network Progress Card (PRD-058)
 * Displays aggregated drops/fiber progress
 */

import React from 'react';
import { Signal } from 'lucide-react';
import type { NetworkProgress } from './types';

interface NetworkProgressCardProps {
  network: NetworkProgress;
  isLoading?: boolean;
}

export function NetworkProgressCard({ network, isLoading = false }: NetworkProgressCardProps) {
  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const progressPercent = Math.min(network.progressPercent, 100);
  const remaining = network.totalDrops - network.completedDrops;

  return (
    <div className="ff-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">
          Network Progress
        </h3>
        <div className="p-2 rounded-lg bg-cyan-500/20">
          <Signal className="w-5 h-5 text-cyan-400" />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-[var(--ff-text-secondary)] mb-1">
          <span>{network.progressPercent.toFixed(1)}% complete</span>
          <span>{network.completedDrops.toLocaleString()} / {network.totalDrops.toLocaleString()} drops</span>
        </div>
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {network.totalDrops.toLocaleString()}
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)]">Total Drops</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">
            {network.completedDrops.toLocaleString()}
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)]">Completed</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-600">
            {remaining.toLocaleString()}
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)]">Remaining</p>
        </div>
      </div>
    </div>
  );
}

export default NetworkProgressCard;
