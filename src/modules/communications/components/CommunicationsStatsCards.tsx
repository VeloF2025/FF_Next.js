import { Calendar, CheckCircle, Bell, AlertCircle } from 'lucide-react';
import { CommunicationsStats } from '@/types/communications.types';

interface CommunicationsStatsCardsProps {
  stats: CommunicationsStats;
}

export function CommunicationsStatsCards({ stats }: CommunicationsStatsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Upcoming Meetings</p>
              <p className="text-2xl font-bold">{stats.upcomingMeetings}</p>
            </div>
            <Calendar className="w-8 h-8 text-blue-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Pending Actions</p>
              <p className="text-2xl font-bold">{stats.pendingActions}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Unread</p>
              <p className="text-2xl font-bold">{stats.unreadNotifications}</p>
            </div>
            <Bell className="w-8 h-8 text-purple-500" />
          </div>
        </div>
      </div>

      <div className="ff-card">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ff-text-secondary)]">Overdue</p>
              <p className="text-2xl font-bold">{stats.overdueItems}</p>
            </div>
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}