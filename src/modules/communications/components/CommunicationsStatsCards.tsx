'use client';

import { Calendar, CheckCircle, Bell, AlertCircle } from 'lucide-react';
import { CommunicationsStats } from '@/types/communications.types';

interface CommunicationsStatsCardsProps {
  stats: CommunicationsStats;
}

/**
 * Communications Stats Cards - Following Maintenance Dashboard pattern
 *
 * Pattern: Small icon + label at top, big value below
 * @see src/modules/maintenance/components/Dashboard/TicketingDashboard.tsx
 */
export function CommunicationsStatsCards({ stats }: CommunicationsStatsCardsProps) {
  const cards = [
    {
      label: 'Upcoming Meetings',
      value: stats.upcomingMeetings,
      icon: Calendar,
      iconColor: 'text-blue-400',
    },
    {
      label: 'Pending Actions',
      value: stats.pendingActions,
      icon: CheckCircle,
      iconColor: 'text-yellow-400',
    },
    {
      label: 'Unread',
      value: stats.unreadNotifications,
      icon: Bell,
      iconColor: 'text-purple-400',
    },
    {
      label: 'Overdue',
      value: stats.overdueItems,
      icon: AlertCircle,
      iconColor: 'text-red-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4"
          >
            {/* Header: small icon + label */}
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${card.iconColor}`} />
              <p className="text-sm text-[var(--ff-text-secondary)]">{card.label}</p>
            </div>

            {/* Value */}
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}