'use client';

import { BarChart3, Users, Calendar, Target, Download, RefreshCw, Settings } from 'lucide-react';
import { useRouter } from 'next/router';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { useKPIDashboardData } from '@/hooks/useDashboardData';
import { getKPIDashboardCards } from '@/config/dashboards/dashboardConfigs';

export function KPIDashboard() {
  const router = useRouter();

  const { 
    stats, 
    trends, 
    isLoading: _isLoading, 
    error: _error, 
    formatNumber, 
    formatCurrency, 
    formatPercentage,
    loadDashboardData 
  } = useKPIDashboardData();

  // Note: isLoading and error states could be used for loading indicators and error handling
  // but are currently not implemented in the UI layer

  // 🟢 WORKING: Get KPI dashboard cards
  const dashboardKpiCards = getKPIDashboardCards(
    stats, 
    trends, 
    { formatNumber, formatCurrency, formatPercentage }
  );

  // Legacy KPI cards for comparison
  const legacyKpiCards = [
    {
      title: 'Project KPIs',
      value: '87%',
      change: '+5%',
      icon: BarChart3,
      color: 'bg-blue-500',
      trend: 'up',
    },
    {
      title: 'Team Performance',
      value: '92%',
      change: '+3%',
      icon: Users,
      color: 'bg-green-500',
      trend: 'up',
    },
    {
      title: 'Timeline Adherence',
      value: '78%',
      change: '-2%',
      icon: Calendar,
      color: 'bg-purple-500',
      trend: 'down',
    },
    {
      title: 'Quality Score',
      value: '95%',
      change: '+1%',
      icon: Target,
      color: 'bg-orange-500',
      trend: 'up',
    },
  ];

  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title="KPI Dashboard"
        subtitle="Real-time performance metrics and key performance indicators"
        actions={[
          {
            label: 'Configure KPIs',
            icon: Settings as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push('/kpi-dashboard/settings'),
            variant: 'secondary'
          },
          {
            label: 'Export Dashboard',
            icon: Download as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push('/kpi-dashboard/export'),
            variant: 'secondary'
          },
          {
            label: 'Refresh Data',
            icon: RefreshCw as React.ComponentType<{ className?: string; }>,
            onClick: loadDashboardData,
            variant: 'primary'
          }
        ]}
      />

      {/* Enhanced KPI Stats Cards */}
      <StatsGrid 
        cards={dashboardKpiCards}
        columns={3}
        className="mb-8"
      />

      {/* Legacy KPI Cards for comparison */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-foreground mb-4">Legacy KPI View</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {legacyKpiCards.map((kpi) => (
            <div key={kpi.title} className="bg-card rounded-lg shadow-sm border border-border p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`${kpi.color} p-3 rounded-lg`}>
                  <kpi.icon className="w-6 h-6 text-white" />
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-foreground">{kpi.value}</p>
                  <span className={`text-sm ${kpi.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                    {kpi.change} vs last month
                  </span>
                </div>
              </div>
              <h3 className="text-sm font-medium text-muted-foreground">{kpi.title}</h3>
            </div>
          ))}
        </div>
      </div>

      {/* Chart Placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Performance Trend</h2>
          <div className="h-64 flex items-center justify-center bg-background rounded">
            <p className="text-muted-foreground">Chart visualization coming soon</p>
          </div>
        </div>
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Team Comparison</h2>
          <div className="h-64 flex items-center justify-center bg-background rounded">
            <p className="text-muted-foreground">Chart visualization coming soon</p>
          </div>
        </div>
      </div>

      {/* Recent Performance */}
      <div className="mt-6 bg-card rounded-lg shadow-sm border border-border p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Recent Performance Updates</h2>
        <div className="space-y-4">
          <p className="text-muted-foreground text-center">No recent updates</p>
        </div>
      </div>
    </div>
  );
}