'use client';

import { FileText, Download, Filter, PieChart, BarChart3, TrendingUp, Clock, Plus, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StatsGrid } from '../../components/dashboard/EnhancedStatCard';
import { DashboardHeader } from '../../components/dashboard/DashboardHeader';
import { useReportsDashboardData } from '../../hooks/useDashboardData';
import { getReportsDashboardCards } from '../../config/dashboards/dashboardConfigs';

export default function ReportsDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('all');

  const { 
    stats, 
    trends, 
    isLoading: _isLoading, 
    error: _error, 
    formatNumber, 
    formatCurrency, 
    formatPercentage,
    loadDashboardData 
  } = useReportsDashboardData();

  // Note: isLoading and error states could be used for loading indicators and error handling
  // but are currently not implemented in the UI layer

  // 🟢 WORKING: Get reports dashboard cards
  const reportsCards = getReportsDashboardCards(
    stats, 
    trends, 
    { formatNumber, formatCurrency, formatPercentage }
  );

  const tabs = [
    { id: 'all', label: 'All Reports' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'custom', label: 'Custom' },
    { id: 'templates', label: 'Templates' },
  ];

  const reportCategories = [
    {
      title: 'Project Reports',
      description: 'Detailed project progress and status',
      icon: FileText,
      color: 'bg-blue-500',
      count: 12,
      onClick: () => router.push('/reports/projects'),
    },
    {
      title: 'Financial Reports',
      description: 'Budget, costs and financial analysis',
      icon: BarChart3,
      color: 'bg-green-500',
      count: 8,
      onClick: () => router.push('/reports/financial'),
    },
    {
      title: 'Performance Reports',
      description: 'KPIs and performance metrics',
      icon: TrendingUp,
      color: 'bg-purple-500',
      count: 15,
      onClick: () => router.push('/reports/performance'),
    },
    {
      title: 'Resource Reports',
      description: 'Staff, equipment and materials',
      icon: PieChart,
      color: 'bg-orange-500',
      count: 6,
      onClick: () => router.push('/reports/resources'),
    },
    {
      title: 'Custom Reports',
      description: 'Create custom report templates',
      icon: Filter,
      color: 'bg-indigo-500',
      onClick: () => router.push('/reports/custom'),
    },
    {
      title: 'Scheduled Reports',
      description: 'Automated report generation',
      icon: Clock,
      color: 'bg-pink-500',
      count: 4,
      onClick: () => router.push('/reports/scheduled'),
    },
  ];

  const recentReports = [
    { name: 'Monthly Progress Report', date: '2025-08-15', type: 'Performance', status: 'ready' },
    { name: 'Q2 Financial Summary', date: '2025-08-10', type: 'Financial', status: 'ready' },
    { name: 'Project Status Update', date: '2025-08-05', type: 'Project', status: 'ready' },
  ];

  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title="Reports Dashboard"
        subtitle="Generate, manage and analyze business reports"
        actions={[
          {
            label: 'Create Report',
            icon: Plus as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push('/reports/create'),
            variant: 'primary'
          },
          {
            label: 'Export All',
            icon: Download as React.ComponentType<{ className?: string; }>,
            onClick: () => router.push('/reports/export'),
            variant: 'secondary'
          },
          {
            label: 'Refresh Data',
            icon: RefreshCw as React.ComponentType<{ className?: string; }>,
            onClick: loadDashboardData,
            variant: 'secondary'
          }
        ]}
      />

      {/* Enhanced Reports Stats Cards */}
      <StatsGrid 
        cards={reportsCards}
        columns={3}
        className="mb-8"
      />

      {/* Tabs */}
      <div className="border-b border-[var(--ff-border-light)] mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                py-2 px-1 border-b-2 font-medium text-sm transition-colors
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

      {/* Report Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {reportCategories.map((category) => (
          <div
            key={category.title}
            onClick={category.onClick}
            className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start space-x-4">
              <div className={`${category.color} p-3 rounded-lg`}>
                <category.icon className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-1">
                  {category.title}
                  {category.count !== undefined && (
                    <span className="ml-2 text-sm font-normal text-[var(--ff-text-secondary)]">
                      ({category.count})
                    </span>
                  )}
                </h3>
                <p className="text-sm text-[var(--ff-text-secondary)]">{category.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Reports */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)]">
        <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Reports</h2>
        </div>
        <div className="p-6">
          {recentReports.length > 0 ? (
            <div className="space-y-3">
              {recentReports.map((report, index) => (
                <div key={index} className="flex items-center justify-between p-3 hover:bg-[var(--ff-bg-hover)] rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-[var(--ff-text-tertiary)]" />
                    <div>
                      <p className="font-medium text-[var(--ff-text-primary)]">{report.name}</p>
                      <p className="text-sm text-[var(--ff-text-secondary)]">{report.type} • {report.date}</p>
                    </div>
                  </div>
                  <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                    Download
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--ff-text-secondary)] text-center">No recent reports</p>
          )}
        </div>
      </div>
    </div>
  );
}