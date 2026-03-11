'use client';

import { Home, Wifi, Activity, Users, DollarSign } from 'lucide-react';
import { AnalyticsStats } from '../types/analytics.types';

interface AnalyticsStatsCardsProps {
  stats: AnalyticsStats;
  formatNumber: (num: number) => string;
}

/**
 * Analytics Stats Cards - Following Maintenance Dashboard pattern
 *
 * Pattern: Small icon + label at top, big value below
 * @see src/modules/noc/components/Dashboard/TicketingDashboard.tsx
 */
export function AnalyticsStatsCards({ stats, formatNumber }: AnalyticsStatsCardsProps) {
  const cards = [
    {
      label: 'Total Poles',
      value: formatNumber(stats.totalPoles),
      icon: Home,
      iconColor: 'text-blue-400',
      trend: { value: 12, isPositive: true },
    },
    {
      label: 'Total Drops',
      value: formatNumber(stats.totalDrops),
      icon: Wifi,
      iconColor: 'text-purple-400',
      trend: { value: 8, isPositive: true },
    },
    {
      label: 'Fiber Installed',
      value: `${formatNumber(stats.totalFiber)}m`,
      icon: Activity,
      iconColor: 'text-orange-400',
      trend: { value: 3, isPositive: false },
    },
    {
      label: 'Active Teams',
      value: stats.activeTeams.toString(),
      icon: Users,
      iconColor: 'text-green-400',
      subtitle: 'All operational',
    },
    {
      label: 'Revenue',
      value: `R${formatNumber(stats.totalRevenue)}`,
      icon: DollarSign,
      iconColor: 'text-emerald-400',
      trend: { value: 15, isPositive: true },
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
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

            {/* Subtitle or Trend */}
            {card.subtitle && (
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{card.subtitle}</p>
            )}
            {card.trend && (
              <div className="flex items-center gap-1 mt-1">
                <span className={`text-xs font-medium ${
                  card.trend.isPositive ? 'text-green-400' : 'text-red-400'
                }`}>
                  {card.trend.isPositive ? '↑' : '↓'} {Math.abs(card.trend.value)}%
                </span>
                <span className="text-xs text-[var(--ff-text-tertiary)]">vs last period</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
