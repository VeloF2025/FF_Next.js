/**
 * Budget Dashboard Widget Component
 * PRD-057: Project Budget Tracking System
 *
 * Compact widget for displaying budget status on project dashboards
 * Shows utilization donut chart, key metrics, and active alerts
 */

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, XCircle, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import type { BudgetHealth, BudgetStatus } from '@/types/budget';

interface BudgetDashboardWidgetProps {
  projectId: string;
  totalBudget: number;
  committedAmount: number;
  actualAmount: number;
  availableBudget: number;
  utilizationPercent: number;
  health: BudgetHealth;
  status: BudgetStatus;
  currency?: string;
  activeAlerts?: number;
  loading?: boolean;
}

const formatCompact = (amount: number, currency = 'ZAR'): string => {
  const formatter = new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  return formatter.format(amount);
};

const getHealthIcon = (health: BudgetHealth) => {
  switch (health) {
    case 'healthy':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    case 'critical':
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return null;
  }
};

const getHealthColor = (health: BudgetHealth): string => {
  switch (health) {
    case 'healthy':
      return '#22c55e'; // green-500
    case 'warning':
      return '#eab308'; // yellow-500
    case 'critical':
      return '#ef4444'; // red-500
    default:
      return '#6b7280'; // gray-500
  }
};

const getHealthBgColor = (health: BudgetHealth): string => {
  switch (health) {
    case 'healthy':
      return 'bg-green-50';
    case 'warning':
      return 'bg-yellow-50';
    case 'critical':
      return 'bg-red-50';
    default:
      return 'bg-background';
  }
};

// Simple SVG Donut Chart
function DonutChart({
  percent,
  health,
  size = 80,
  strokeWidth = 8,
}: {
  percent: number;
  health: BudgetHealth;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (Math.min(percent, 100) / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getHealthColor(health)}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-500"
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold">{Math.round(percent)}%</span>
      </div>
    </div>
  );
}

export function BudgetDashboardWidget({
  projectId,
  totalBudget,
  committedAmount,
  actualAmount,
  availableBudget,
  utilizationPercent,
  health,
  status,
  currency = 'ZAR',
  activeAlerts = 0,
  loading = false,
}: BudgetDashboardWidgetProps) {
  if (loading) {
    return (
      <div
        className="bg-card rounded-lg border border-border shadow-sm p-4"
        data-testid="budget-widget"
      >
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-secondary rounded w-1/3"></div>
          <div className="flex justify-between">
            <div className="h-16 w-16 bg-secondary rounded-full"></div>
            <div className="space-y-2 flex-1 ml-4">
              <div className="h-4 bg-secondary rounded w-full"></div>
              <div className="h-4 bg-secondary rounded w-3/4"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const variance = totalBudget - committedAmount;
  const variancePercent = totalBudget > 0 ? (variance / totalBudget) * 100 : 0;
  const isUnderBudget = variance >= 0;

  return (
    <div
      className={`bg-card rounded-lg border border-border shadow-sm overflow-hidden ${
        health === 'critical' ? 'ring-2 ring-red-200' : ''
      }`}
      data-testid="budget-widget"
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Budget Status</h3>
            {getHealthIcon(health)}
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            status === 'approved' ? 'bg-green-100 text-green-800' :
            status === 'locked' ? 'bg-secondary text-foreground' :
            'bg-blue-100 text-blue-800'
          }`}>
            {status}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Donut Chart */}
          <DonutChart percent={utilizationPercent} health={health} />

          {/* Stats */}
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Total Budget</p>
              <p className="text-lg font-bold">{formatCompact(totalBudget, currency)}</p>
            </div>
            <div className="flex items-center gap-1">
              {isUnderBudget ? (
                <TrendingDown className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingUp className="h-3 w-3 text-red-500" />
              )}
              <span className={`text-xs font-medium ${isUnderBudget ? 'text-green-600' : 'text-red-600'}`}>
                {isUnderBudget ? 'Under' : 'Over'} by {Math.abs(variancePercent).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* Quick Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-sm font-semibold text-foreground">{formatCompact(committedAmount, currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Actual</p>
            <p className="text-sm font-semibold text-foreground">{formatCompact(actualAmount, currency)}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="text-sm font-semibold text-green-600">{formatCompact(availableBudget, currency)}</p>
          </div>
        </div>

        {/* Alerts Banner */}
        {activeAlerts > 0 && (
          <div className={`mt-4 p-2 rounded-lg ${getHealthBgColor(health)}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-4 w-4 ${
                  health === 'critical' ? 'text-red-500' : 'text-yellow-500'
                }`} />
                <span className="text-xs font-medium">
                  {activeAlerts} active alert{activeAlerts > 1 ? 's' : ''}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Link */}
      <Link
        href={`/projects/${projectId}/budget`}
        className="flex items-center justify-between p-3 bg-background border-t border-gray-100 hover:bg-secondary transition-colors"
      >
        <span className="text-sm font-medium text-muted-foreground">View Budget Details</span>
        <ArrowRight className="h-4 w-4 text-gray-400" />
      </Link>
    </div>
  );
}

// Empty state component for projects without budgets
export function BudgetDashboardWidgetEmpty({ projectId }: { projectId: string }) {
  return (
    <div
      className="bg-card rounded-lg border border-border shadow-sm p-4"
      data-testid="budget-widget-empty"
    >
      <div className="text-center py-4">
        <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center mx-auto mb-3">
          <TrendingUp className="h-5 w-5 text-gray-400" />
        </div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-1">No Budget Set</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Set up a budget to track project spending
        </p>
        <Link
          href={`/projects/${projectId}/budget`}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-md hover:bg-blue-100"
        >
          Create Budget
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

export default BudgetDashboardWidget;
