import { Calendar, Clock, FileText, Users } from 'lucide-react';
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Today's Meetings</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.todayMeetings}</p>
            </div>
            <Calendar className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">This Week</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.weekMeetings}</p>
            </div>
            <Clock className="w-8 h-8 text-green-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Action Items</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.actionItems}</p>
            </div>
            <FileText className="w-8 h-8 text-orange-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Hours</p>
              <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{stats.totalHours}h</p>
            </div>
            <Users className="w-8 h-8 text-purple-500" />
          </div>
        </div>
      </div>
    </div>
  );
}