import { Cable, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import { FiberStats } from '../types/fiberStringing.types';

interface FiberStatsCardsProps {
  stats: FiberStats;
}

export function FiberStatsCards({ stats }: FiberStatsCardsProps) {
  return (
    <StatCardGrid columns={4}>
      <StatCard
        label="Total Sections"
        value={stats.sectionsTotal}
        icon={Cable}
        colorType="total"
        subtitle={`${stats.totalDistance}m total distance`}
      />
      <StatCard
        label="Completed"
        value={stats.sectionsCompleted}
        icon={CheckCircle}
        colorType="completed"
        subtitle={`${stats.completedDistance}m installed`}
      />
      <StatCard
        label="In Progress"
        value={stats.sectionsInProgress}
        icon={Clock}
        colorType="inProgress"
        subtitle="Active installations"
      />
      <StatCard
        label="Avg Speed"
        value={`${stats.averageSpeed.toFixed(0)}m/day`}
        icon={TrendingUp}
        colorType="warning"
        subtitle={`Est. completion: ${stats.estimatedCompletion}`}
      />
    </StatCardGrid>
  );
}