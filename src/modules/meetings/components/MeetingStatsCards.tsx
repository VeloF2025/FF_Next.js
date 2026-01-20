import { Calendar, Clock, FileText, Users } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import type { Meeting } from '../types/meeting.types';

interface MeetingStatsCardsProps {
  meetings: Meeting[];
}

export function MeetingStatsCards({ meetings }: MeetingStatsCardsProps) {
  const stats = {
    todayMeetings: meetings.filter(m => m.status === 'scheduled').length,
    weekMeetings: meetings.filter(m => m.status === 'scheduled').length * 3,
    actionItems: meetings.reduce((sum, m) => sum + m.actionItems.filter(a => !a.completed).length, 0),
    totalHours: meetings.reduce((sum, m) => {
      const hours = parseInt(m.duration) || 0;
      return sum + hours;
    }, 0)
  };

  return (
    <StatCardGrid columns={4} className="mb-6">
      <StatCard
        label="Today's Meetings"
        value={stats.todayMeetings}
        icon={Calendar}
        colorType="total"
      />
      <StatCard
        label="This Week"
        value={stats.weekMeetings}
        icon={Clock}
        colorType="active"
      />
      <StatCard
        label="Action Items"
        value={stats.actionItems}
        icon={FileText}
        colorType="warning"
      />
      <StatCard
        label="Total Hours"
        value={`${stats.totalHours}h`}
        icon={Users}
        colorType="financial"
      />
    </StatCardGrid>
  );
}