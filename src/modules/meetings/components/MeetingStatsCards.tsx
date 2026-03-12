import { Calendar, Clock, FileText, Users } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import type { Meeting } from '../types/meeting.types';

interface MeetingStatsCardsProps {
  meetings: Meeting[];
  totalMeetings?: number;
}

export function MeetingStatsCards({ meetings, totalMeetings }: MeetingStatsCardsProps) {
  const stats = {
    totalMeetings: totalMeetings ?? meetings.length,
    totalAttendees: meetings.reduce((sum, m) => sum + (m.participants?.length || 0), 0),
    actionItems: meetings.reduce((sum, m) => sum + m.actionItems.filter(a => !a.completed).length, 0),
    totalMinutes: meetings.reduce((sum, m) => {
      const mins = parseInt(m.duration) || 0;
      return sum + mins;
    }, 0)
  };

  return (
    <StatCardGrid columns={4} className="mb-6">
      <StatCard
        label="Total Meetings"
        value={stats.totalMeetings}
        icon={Calendar}
        colorType="total"
      />
      <StatCard
        label="Total Attendees"
        value={stats.totalAttendees}
        icon={Users}
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
        value={`${Math.round(stats.totalMinutes / 60)}h`}
        icon={Clock}
        colorType="financial"
      />
    </StatCardGrid>
  );
}