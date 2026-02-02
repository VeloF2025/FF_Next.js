/**
 * Budget Health Card (PRD-058)
 * Displays aggregated budget metrics with health indicator
 */

import React from 'react';
import type { BudgetMetrics } from './types';

interface BudgetHealthCardProps {
  budget: BudgetMetrics;
  isLoading?: boolean;
}

/**
 * Format currency in ZAR
 */
function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `R ${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `R ${(value / 1000).toFixed(0)}K`;
  }
  return `R ${value.toLocaleString()}`;
}

/**
 * Get health indicator color
 */
function getHealthColor(health: BudgetMetrics['health']): {
  text: string;
  bg: string;
  dot: string;
} {
  switch (health) {
    case 'healthy':
      return { text: 'text-green-600', bg: 'bg-green-100', dot: 'bg-green-500' };
    case 'warning':
      return { text: 'text-amber-600', bg: 'bg-amber-100', dot: 'bg-amber-500' };
    case 'critical':
      return { text: 'text-red-600', bg: 'bg-red-100', dot: 'bg-red-500' };
    default:
      return { text: 'text-gray-600', bg: 'bg-gray-100', dot: 'bg-gray-500' };
  }
}

export function BudgetHealthCard({ budget, isLoading = false }: BudgetHealthCardProps) {
  const healthColors = getHealthColor(budget.health);
  const hasNoBudget = budget.totalBudget === 0;

  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  // Show empty state when no budget data
  if (hasNoBudget) {
    return (
      <div className="ff-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] tracking-wide">
            Budget Overview
          </h3>
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-800">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            <span className="text-xs font-medium text-gray-500">No Data</span>
          </div>
        </div>
        <div className="text-center py-6">
          <p className="text-[var(--ff-text-secondary)] text-sm">
            No project budgets configured yet
          </p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            Add budgets to projects to see financial health
          </p>
        </div>
      </div>
    );
  }

  const progressPercent = Math.min(budget.utilizationPercent, 100);

  return (
    <div className="ff-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] tracking-wide">
          Budget Overview
        </h3>
        <div className={`flex items-center gap-2 px-2 py-1 rounded-full ${healthColors.bg}`}>
          <span className={`w-2 h-2 rounded-full ${healthColors.dot}`} />
          <span className={`text-xs font-medium capitalize ${healthColors.text}`}>
            {budget.health}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-[var(--ff-text-secondary)] mb-1">
          <span>{budget.utilizationPercent.toFixed(0)}% utilized</span>
          <span>{formatCurrency(budget.totalActual)} / {formatCurrency(budget.totalBudget)}</span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              budget.health === 'healthy' ? 'bg-green-500' :
              budget.health === 'warning' ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Metrics - simplified 2 column */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Budget</p>
          <p className="font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(budget.totalBudget)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Spent</p>
          <p className="font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(budget.totalActual)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default BudgetHealthCard;
