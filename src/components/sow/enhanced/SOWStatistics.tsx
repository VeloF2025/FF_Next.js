/**
 * SOW Statistics Component
 * Shows meaningful pole utilization statistics
 */

import type { PoleData } from '@/types/sow/pole.types';
import type { DropData } from '@/types/sow/drop.types';

interface SOWStatisticsProps {
  poles: PoleData[];
  drops: DropData[];
  totalPoles: number;  // Actual count from API (not limited array)
  totalDrops: number;  // Actual count from API (not limited array)
}

export function SOWStatistics({ poles, drops, totalPoles, totalDrops }: SOWStatisticsProps) {
  if (totalPoles === 0) {
    return null;
  }

  // Calculate actual average drops per pole
  const avgDropsPerPole = totalDrops / totalPoles;

  // Calculate capacity assuming 12 drops max per pole (industry standard)
  const maxDropsPerPole = 12;
  const totalCapacity = totalPoles * maxDropsPerPole;

  // Utilization = actual drops / total capacity
  const utilization = (totalDrops / totalCapacity) * 100;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
      <h4 className="font-medium text-amber-500 mb-3">Pole Utilization</h4>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-[var(--ff-text-secondary)]">Drops per Pole:</span>
          <span className="ml-2 font-medium text-amber-400">
            {avgDropsPerPole.toFixed(1)} avg
          </span>
        </div>
        <div>
          <span className="text-[var(--ff-text-secondary)]">Max Capacity:</span>
          <span className="ml-2 font-medium text-amber-400">
            {totalCapacity.toLocaleString()} drops
          </span>
        </div>
        <div>
          <span className="text-[var(--ff-text-secondary)]">Utilization:</span>
          <span className="ml-2 font-medium text-amber-400">
            {utilization.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}