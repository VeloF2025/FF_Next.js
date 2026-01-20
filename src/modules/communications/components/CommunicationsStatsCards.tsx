import { Calendar, CheckCircle, Bell, AlertCircle } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import { CommunicationsStats } from '@/types/communications.types';

interface CommunicationsStatsCardsProps {
  stats: CommunicationsStats;
}

export function CommunicationsStatsCards({ stats }: CommunicationsStatsCardsProps) {
  return (
    <StatCardGrid columns={4} className="mb-6">
      <StatCard
        label="Upcoming Meetings"
        value={stats.upcomingMeetings}
        icon={Calendar}
        colorType="total"
      />
      <StatCard
        label="Pending Actions"
        value={stats.pendingActions}
        icon={CheckCircle}
        colorType="pending"
      />
      <StatCard
        label="Unread"
        value={stats.unreadNotifications}
        icon={Bell}
        colorType="financial"
      />
      <StatCard
        label="Overdue"
        value={stats.overdueItems}
        icon={AlertCircle}
        colorType="error"
      />
    </StatCardGrid>
  );
}