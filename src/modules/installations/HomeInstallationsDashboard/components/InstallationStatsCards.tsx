import { Home, CheckCircle, Wrench, Clock, AlertTriangle, Activity } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import { InstallationStats } from '../types/installation.types';

interface InstallationStatsCardsProps {
  stats: InstallationStats;
}

export function InstallationStatsCards({ stats }: InstallationStatsCardsProps) {
  return (
    <StatCardGrid columns={5} className="mb-6">
      <StatCard
        label="Total"
        value={stats.total}
        icon={Home}
        colorType="total"
      />
      <StatCard
        label="Completed"
        value={stats.completed}
        icon={CheckCircle}
        colorType="completed"
      />
      <StatCard
        label="In Progress"
        value={stats.inProgress}
        icon={Wrench}
        colorType="inProgress"
      />
      <StatCard
        label="Scheduled"
        value={stats.scheduled}
        icon={Clock}
        colorType="pending"
      />
      <StatCard
        label="Issues"
        value={stats.issues}
        icon={AlertTriangle}
        colorType="error"
      />
      <StatCard
        label="Avg Speed"
        value={`${Math.round(stats.avgSpeed)} Mbps`}
        icon={Activity}
        colorType="financial"
      />
    </StatCardGrid>
  );
}