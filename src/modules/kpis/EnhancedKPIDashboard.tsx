'use client';

import { Target, TrendingUp, BarChart3, PieChart, Activity, Settings } from 'lucide-react';
import { useRouter } from 'next/router';
import { useState } from 'react';

export function EnhancedKPIDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('operational');

  const tabs = [
    { id: 'operational', label: 'Operational KPIs' },
    { id: 'financial', label: 'Financial KPIs' },
    { id: 'quality', label: 'Quality KPIs' },
    { id: 'customer', label: 'Customer KPIs' },
  ];

  const cards = [
    {
      title: 'KPI Overview',
      description: 'View all key performance indicators',
      icon: BarChart3,
      color: 'bg-blue-500',
      onClick: () => router.push('/app/kpis/overview'),
    },
    {
      title: 'Set Targets',
      description: 'Define KPI targets and thresholds',
      icon: Target,
      color: 'bg-green-500',
      onClick: () => router.push('/app/kpis/targets'),
    },
    {
      title: 'Performance Trends',
      description: 'Analyze performance over time',
      icon: TrendingUp,
      color: 'bg-purple-500',
      onClick: () => router.push('/app/kpis/trends'),
    },
    {
      title: 'Comparisons',
      description: 'Compare KPIs across teams/projects',
      icon: PieChart,
      color: 'bg-orange-500',
      onClick: () => router.push('/app/kpis/compare'),
    },
    {
      title: 'Real-time Monitor',
      description: 'Live KPI monitoring dashboard',
      icon: Activity,
      color: 'bg-indigo-500',
      onClick: () => router.push('/app/kpis/monitor'),
    },
    {
      title: 'Configure KPIs',
      description: 'Manage KPI definitions',
      icon: Settings,
      color: 'bg-pink-500',
      onClick: () => router.push('/app/kpis/configure'),
    },
  ];

  const kpiMetrics = [
    { name: 'Overall Performance', value: 0, target: 95, unit: '%', status: 'critical' },
    { name: 'Project Completion', value: 0, target: 100, unit: '%', status: 'warning' },
    { name: 'Resource Utilization', value: 0, target: 85, unit: '%', status: 'good' },
    { name: 'Customer Satisfaction', value: 0, target: 4.5, unit: '/5', status: 'good' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-muted-foreground';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'good': return 'Good';
      case 'warning': return 'Warning';
      case 'critical': return 'Critical';
      default: return status;
    }
  };

  const activeTabPanelId = `kpi-panel-${activeTab}`;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Enhanced KPIs Dashboard</h1>
        <p className="text-[var(--ff-text-secondary)] mt-1">Monitor and analyze key performance indicators</p>
      </div>

      {/* Tabs — WCAG: role="tablist" with aria-label, each tab has role="tab" + aria-selected + aria-controls */}
      <div className="border-b border-[var(--ff-border-light)] mb-6">
        <nav role="tablist" aria-label="KPI categories" className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              id={`kpi-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={`kpi-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:border-[var(--ff-border-light)]'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panel — WCAG: role="tabpanel" + id + aria-labelledby */}
      <div
        role="tabpanel"
        id={activeTabPanelId}
        aria-labelledby={`kpi-tab-${activeTab}`}
      >
        {/* KPI Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {kpiMetrics.map((metric) => {
            const progressPercent = Math.min(100, Math.round((metric.value / metric.target) * 100));
            return (
              <div key={metric.name} className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-4">
                <div className="flex justify-between items-start mb-2">
                  <p className="text-sm text-[var(--ff-text-secondary)]">{metric.name}</p>
                  {/* WCAG: use CSS uppercase class instead of JS .toUpperCase() to preserve semantic text for screen readers */}
                  <span className={`text-xs font-semibold uppercase tracking-wide ${getStatusColor(metric.status)}`}>
                    {getStatusLabel(metric.status)}
                  </span>
                </div>
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {metric.value}{metric.unit}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">
                    Target: {metric.target}{metric.unit}
                  </p>
                </div>
                {/* WCAG: role="progressbar" with aria-valuenow/min/max and aria-label */}
                <div className="mt-2 w-full bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                  <div
                    role="progressbar"
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${metric.name}: ${progressPercent}% of target`}
                    className={`h-2 rounded-full ${
                      metric.status === 'good' ? 'bg-green-500' :
                      metric.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Navigation Cards — WCAG: changed from <div onClick> to <button> for keyboard accessibility */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <button
              key={card.title}
              type="button"
              onClick={card.onClick}
              className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--ff-accent)] focus:ring-offset-1 transition-shadow cursor-pointer text-left w-full"
            >
              <div className="flex items-start space-x-4">
                <div className={`${card.color} p-3 rounded-lg`} aria-hidden="true">
                  <card.icon className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
                    {card.title}
                  </h3>
                  <p className="text-sm text-[var(--ff-text-secondary)]">{card.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
