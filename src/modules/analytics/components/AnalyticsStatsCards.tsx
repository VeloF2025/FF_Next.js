'use client';

import { Home, Wifi, Activity, Users, DollarSign } from 'lucide-react';
import { StatCard, StatCardGrid } from '@/components/ui/StatCard';
import { AnalyticsStats } from '../types/analytics.types';

interface AnalyticsStatsCardsProps {
  stats: AnalyticsStats;
  formatNumber: (num: number) => string;
}

export function AnalyticsStatsCards({ stats, formatNumber }: AnalyticsStatsCardsProps) {
  return (
    <StatCardGrid columns={5} className="mb-6">
      <StatCard
        label="Total Poles"
        value={formatNumber(stats.totalPoles)}
        icon={Home}
        colorType="total"
        trend={{ value: 12, isPositive: true }}
      />
      <StatCard
        label="Total Drops"
        value={formatNumber(stats.totalDrops)}
        icon={Wifi}
        colorType="financial"
        trend={{ value: 8, isPositive: true }}
      />
      <StatCard
        label="Fiber Installed"
        value={`${formatNumber(stats.totalFiber)}m`}
        icon={Activity}
        colorType="sent"
        trend={{ value: 3, isPositive: false }}
      />
      <StatCard
        label="Active Teams"
        value={stats.activeTeams}
        icon={Users}
        colorType="active"
        subtitle="All operational"
      />
      <StatCard
        label="Revenue"
        value={`R${formatNumber(stats.totalRevenue)}`}
        icon={DollarSign}
        colorType="success"
        trend={{ value: 15, isPositive: true }}
      />
    </StatCardGrid>
  );
}