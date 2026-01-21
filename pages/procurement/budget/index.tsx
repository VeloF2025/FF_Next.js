/**
 * Procurement Budget Dashboard
 * Overview of all project budgets with templates management
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout';
import { StatCard } from '@/components/ui/StatCard';
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  FileText,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  LayoutTemplate,
  Percent,
} from 'lucide-react';
import Link from 'next/link';

// Dark theme colors
const COLORS = {
  bg: {
    primary: '#0f1419',
    secondary: '#1a1d23',
    tertiary: '#1e2128',
    hover: '#252a33',
  },
  border: {
    primary: '#2d3139',
    secondary: '#3d4149',
  },
  text: {
    primary: '#ffffff',
    secondary: '#9ca3af',
    muted: '#6b7280',
  },
};

interface BudgetTemplate {
  id: string;
  code: string;
  name: string;
  description?: string;
  template_type: string;
  category_count: number;
  total_percent: number;
  usage_count: number;
  is_system: boolean;
  categories?: Array<{
    category_code: string;
    category_name: string;
    default_percent?: number;
    color?: string;
  }>;
}

interface ProjectBudget {
  id: string;
  project_id: string;
  project_code?: string;
  project_name?: string;
  total_budget: number;
  committed_amount: number;
  actual_amount: number;
  available_budget: number;
  utilization_percent: number;
  health_status: 'healthy' | 'warning' | 'critical';
  status: string;
  active_alerts: number;
  category_count: number;
}

interface DashboardData {
  summary: {
    projectCount: number;
    totalBudget: number;
    totalCommitted: number;
    totalActual: number;
    totalAvailable: number;
    utilizationPercent: number;
  };
  healthBreakdown: Record<string, { count: number; budgetSum: number }>;
  projectBudgets: ProjectBudget[];
  categoryTotals: Array<{
    category_code: string;
    category_name: string;
    project_count: number;
    total_allocated: number;
    total_committed: number;
    total_actual: number;
  }>;
  activeAlerts: Array<{
    id: string;
    severity: string;
    title: string;
    project_code?: string;
    project_name?: string;
  }>;
}

export default function ProcurementBudgetDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [templates, setTemplates] = useState<BudgetTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'templates'>('overview');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [dashboardRes, templatesRes] = await Promise.all([
        fetch('/api/procurement/budget/dashboard'),
        fetch('/api/procurement/budget/templates'),
      ]);

      const dashboardJson = await dashboardRes.json();
      const templatesJson = await templatesRes.json();

      if (dashboardJson.success) {
        setDashboardData(dashboardJson.data);
      }

      if (templatesJson.success) {
        setTemplates(templatesJson.data || []);
      }
    } catch (err) {
      setError('Failed to load budget data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num || 0);
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'critical': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      default: return 'text-green-400';
    }
  };

  const getHealthBgColor = (health: string) => {
    switch (health) {
      case 'critical': return 'bg-red-500/20';
      case 'warning': return 'bg-yellow-500/20';
      default: return 'bg-green-500/20';
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="p-6 flex items-center justify-center" style={{ backgroundColor: COLORS.bg.primary, minHeight: '100vh' }}>
          <div className="text-gray-400">Loading budget data...</div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6" style={{ backgroundColor: COLORS.bg.primary, minHeight: '100vh' }}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">Budget Overview</h1>
            <p className="text-gray-400">Procurement budget tracking across all projects</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-gray-400 hover:text-white transition-colors"
              style={{ border: `1px solid ${COLORS.border.primary}` }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2" style={{ borderBottom: `1px solid ${COLORS.border.primary}` }}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Budget Overview
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'templates'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Templates
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
            {error}
          </div>
        )}

        {activeTab === 'overview' && dashboardData && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <StatCard
                title="Total Projects"
                value={dashboardData.summary.projectCount}
                icon={FileText}
                colorType="blue"
              />
              <StatCard
                title="Total Budget"
                value={formatCurrency(dashboardData.summary.totalBudget)}
                icon={DollarSign}
                colorType="green"
              />
              <StatCard
                title="Committed"
                value={formatCurrency(dashboardData.summary.totalCommitted)}
                icon={TrendingUp}
                colorType="yellow"
              />
              <StatCard
                title="Available"
                value={formatCurrency(dashboardData.summary.totalAvailable)}
                icon={CheckCircle}
                colorType="purple"
              />
              <StatCard
                title="Utilization"
                value={`${dashboardData.summary.utilizationPercent.toFixed(1)}%`}
                icon={Percent}
                colorType={dashboardData.summary.utilizationPercent > 90 ? 'red' : 'blue'}
              />
            </div>

            {/* Health Breakdown */}
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
            >
              <h3 className="text-white font-medium mb-4">Budget Health Distribution</h3>
              <div className="flex gap-4">
                {(['healthy', 'warning', 'critical'] as const).map(health => {
                  const data = dashboardData.healthBreakdown[health] || { count: 0, budgetSum: 0 };
                  return (
                    <div
                      key={health}
                      className={`flex-1 p-4 rounded-lg ${getHealthBgColor(health)}`}
                    >
                      <div className={`text-2xl font-bold ${getHealthColor(health)}`}>
                        {data.count}
                      </div>
                      <div className="text-gray-400 text-sm capitalize">{health}</div>
                      <div className="text-gray-500 text-xs mt-1">
                        {formatCurrency(data.budgetSum)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Active Alerts */}
            {dashboardData.activeAlerts.length > 0 && (
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
              >
                <h3 className="text-white font-medium mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  Active Alerts ({dashboardData.activeAlerts.length})
                </h3>
                <div className="space-y-2">
                  {dashboardData.activeAlerts.map(alert => (
                    <div
                      key={alert.id}
                      className={`p-3 rounded flex items-center justify-between ${
                        alert.severity === 'critical' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                      }`}
                    >
                      <div>
                        <span className={alert.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'}>
                          {alert.title}
                        </span>
                        <span className="text-gray-500 text-sm ml-2">
                          {alert.project_code} - {alert.project_name}
                        </span>
                      </div>
                      <Link
                        href={`/projects/${alert.id}/budget`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Budgets Table */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
            >
              <div className="p-4 border-b" style={{ borderColor: COLORS.border.primary }}>
                <h3 className="text-white font-medium">Project Budgets</h3>
              </div>
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: COLORS.bg.tertiary }}>
                    <th className="text-left p-4 text-gray-400 font-medium">Project</th>
                    <th className="text-right p-4 text-gray-400 font-medium">Total Budget</th>
                    <th className="text-right p-4 text-gray-400 font-medium">Committed</th>
                    <th className="text-right p-4 text-gray-400 font-medium">Available</th>
                    <th className="text-right p-4 text-gray-400 font-medium">Utilization</th>
                    <th className="text-center p-4 text-gray-400 font-medium">Health</th>
                    <th className="text-center p-4 text-gray-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboardData.projectBudgets.map(budget => (
                    <tr
                      key={budget.id}
                      className="border-t hover:bg-[#252a33]"
                      style={{ borderColor: COLORS.border.primary }}
                    >
                      <td className="p-4">
                        <div className="text-white font-medium">{budget.project_code}</div>
                        <div className="text-gray-500 text-sm">{budget.project_name}</div>
                      </td>
                      <td className="p-4 text-right text-white font-mono">
                        {formatCurrency(budget.total_budget)}
                      </td>
                      <td className="p-4 text-right text-yellow-400 font-mono">
                        {formatCurrency(budget.committed_amount)}
                      </td>
                      <td className="p-4 text-right text-green-400 font-mono">
                        {formatCurrency(budget.available_budget)}
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                budget.utilization_percent > 90 ? 'bg-red-500' :
                                budget.utilization_percent > 70 ? 'bg-yellow-500' : 'bg-green-500'
                              }`}
                              style={{ width: `${Math.min(budget.utilization_percent, 100)}%` }}
                            />
                          </div>
                          <span className="text-gray-400 text-sm w-12 text-right">
                            {budget.utilization_percent.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${getHealthBgColor(budget.health_status)} ${getHealthColor(budget.health_status)}`}>
                          {budget.health_status}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <Link
                          href={`/projects/${budget.project_id}/budget`}
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm"
                        >
                          View <ChevronRight className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {dashboardData.projectBudgets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-gray-400">
                        No project budgets found. Create a budget from a template to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Category Breakdown */}
            {dashboardData.categoryTotals.length > 0 && (
              <div
                className="rounded-lg p-4"
                style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
              >
                <h3 className="text-white font-medium mb-4">Spend by Category</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {dashboardData.categoryTotals.slice(0, 8).map(cat => (
                    <div
                      key={cat.category_code}
                      className="p-3 rounded"
                      style={{ backgroundColor: COLORS.bg.tertiary }}
                    >
                      <div className="text-gray-400 text-sm">{cat.category_name}</div>
                      <div className="text-white font-bold mt-1">
                        {formatCurrency(cat.total_committed)}
                      </div>
                      <div className="text-gray-500 text-xs mt-1">
                        {cat.project_count} project{cat.project_count !== 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'templates' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-white font-medium">Budget Templates</h3>
              <button
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                onClick={() => {/* TODO: Open create template modal */}}
              >
                <Plus className="w-4 h-4" />
                New Template
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map(template => (
                <div
                  key={template.id}
                  className="rounded-lg p-4"
                  style={{ backgroundColor: COLORS.bg.secondary, border: `1px solid ${COLORS.border.primary}` }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <LayoutTemplate className="w-5 h-5 text-blue-400" />
                        <span className="text-white font-medium">{template.name}</span>
                      </div>
                      <span className="text-gray-500 text-xs">{template.code}</span>
                    </div>
                    {template.is_system && (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">
                        System
                      </span>
                    )}
                  </div>

                  {template.description && (
                    <p className="text-gray-400 text-sm mb-3">{template.description}</p>
                  )}

                  <div className="space-y-2 mb-4">
                    {template.categories?.slice(0, 5).map(cat => (
                      <div key={cat.category_code} className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">{cat.category_name}</span>
                        <span className="text-white">{cat.default_percent}%</span>
                      </div>
                    ))}
                    {(template.category_count > 5) && (
                      <div className="text-gray-500 text-sm">
                        +{template.category_count - 5} more categories
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: COLORS.border.primary }}>
                    <span className="text-gray-500 text-xs">
                      Used {template.usage_count} time{template.usage_count !== 1 ? 's' : ''}
                    </span>
                    <button
                      className="text-blue-400 hover:text-blue-300 text-sm"
                      onClick={() => {/* TODO: Open apply template modal */}}
                    >
                      Apply to Project
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
