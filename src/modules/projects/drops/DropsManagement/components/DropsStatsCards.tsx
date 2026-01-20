import { Home, CheckCircle, Clock, Cable } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import type { DropsStats } from '../types/drops.types';

interface DropsStatsCardsProps {
  stats: DropsStats;
  allDropsStats: DropsStats;
}

export function DropsStatsCards({ stats, allDropsStats }: DropsStatsCardsProps) {
  return (
    <StatCardGrid columns={5}>
      <StatCard
        label="Total Drops"
        value={allDropsStats.totalDrops}
        icon={Home}
        colorType="total"
      />
      <StatCard
        label="Completed"
        value={allDropsStats.completedDrops}
        icon={CheckCircle}
        colorType="completed"
      />
      <StatCard
        label="In Progress"
        value={allDropsStats.inProgressDrops}
        icon={Clock}
        colorType="inProgress"
      />
      <StatCard
        label="Pending"
        value={allDropsStats.pendingDrops}
        icon={Clock}
        colorType="pending"
      />
      <StatCard
        label="Cable Used"
        value={`${allDropsStats.totalCableUsed}m`}
        icon={Cable}
        colorType="total"
      />
    </StatCardGrid>
  );
}