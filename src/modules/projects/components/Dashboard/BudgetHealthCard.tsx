/**
 * Budget Health Card (PRD-058)
 * Displays aggregated budget metrics with health indicator
 */

import React from 'react';
import { CurrencyDollarIcon } from '@heroicons/react/24/outline';
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

  if (isLoading) {
    return (
      <div className="ff-card animate-pulse">
        <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  const progressPercent = Math.min(budget.utilizationPercent, 100);

  return (
    <div className="ff-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide">
          Budget Health
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
        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              budget.health === 'healthy' ? 'bg-green-500' :
              budget.health === 'warning' ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Total Budget</p>
          <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(budget.totalBudget)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Committed</p>
          <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(budget.totalCommitted)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Actual Spend</p>
          <p className="text-lg font-semibold text-[var(--ff-text-primary)]">
            {formatCurrency(budget.totalActual)}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--ff-text-secondary)]">Available</p>
          <p className="text-lg font-semibold text-green-600">
            {formatCurrency(budget.available)}
          </p>
        </div>
      </div>
    </div>
  );
}

export default BudgetHealthCard;
