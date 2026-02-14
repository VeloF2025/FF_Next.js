/**
 * DevQueue Analytics Component
 */

import { TrendingUp, Users, Clock, CheckCircle } from 'lucide-react';
import type { DevQueueStats } from '../types/devQueue';

interface DevQueueAnalyticsProps {
  stats: DevQueueStats;
}

export function DevQueueAnalytics({ stats }: DevQueueAnalyticsProps) {
  const cards = [
    {
      title: 'Total Items',
      value: stats.total,
      icon: TrendingUp,
      color: 'bg-blue-500',
    },
    {
      title: 'Total Votes',
      value: stats.totalVotes,
      icon: Users,
      color: 'bg-green-500',
    },
    {
      title: 'In Progress',
      value: stats.inProgress,
      icon: Clock,
      color: 'bg-yellow-500',
    },
    {
      title: 'Completed',
      value: stats.completed,
      icon: CheckCircle,
      color: 'bg-purple-500',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`p-2 rounded-lg ${card.color} bg-opacity-20`}>
                  <Icon className={`h-5 w-5 ${card.color.replace('bg-', 'text-')}`} />
                </div>
              </div>
              <h3 className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                {card.value}
              </h3>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {card.title}
              </p>
            </div>
          );
        })}
      </div>

      {/* Distribution by Priority */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
          Distribution by Priority
        </h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-[var(--ff-text-secondary)]">High Priority</span>
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {stats.byPriority.high}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full"
                style={{
                  width: `${stats.total > 0 ? (stats.byPriority.high / stats.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-[var(--ff-text-secondary)]">Medium Priority</span>
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {stats.byPriority.medium}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-yellow-500 h-2 rounded-full"
                style={{
                  width: `${stats.total > 0 ? (stats.byPriority.medium / stats.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-[var(--ff-text-secondary)]">Low Priority</span>
              <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                {stats.byPriority.low}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full"
                style={{
                  width: `${stats.total > 0 ? (stats.byPriority.low / stats.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Distribution by Status */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-4">
          Distribution by Status
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <div key={status} className="text-center">
              <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                {count}
              </p>
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {status}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}