/**
 * Budget Health Widget
 * Shows budget utilization and health status
 */

import type { BudgetSummary } from '@/types/finance';

interface BudgetHealthWidgetProps {
  budget: BudgetSummary | null;
  onViewBudget?: () => void;
}

export function BudgetHealthWidget({ budget, onViewBudget }: BudgetHealthWidgetProps) {
  if (!budget) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Budget</h3>
        </div>
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-[var(--ff-text-secondary)] mb-4">No budget configured for this project</p>
          {onViewBudget && (
            <button
              onClick={onViewBudget}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Configure Budget
            </button>
          )}
        </div>
      </div>
    );
  }

  const healthColors = {
    healthy: { bg: 'bg-green-500', text: 'text-green-400', ring: 'ring-green-500' },
    warning: { bg: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500' },
    critical: { bg: 'bg-red-500', text: 'text-red-400', ring: 'ring-red-500' },
  };

  const colors = healthColors[budget.health];
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDashoffset = circumference - (budget.utilizationPercent / 100) * circumference;

  return (
    <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Budget Health</h3>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            R {budget.totalBudget.toLocaleString()} total
          </p>
        </div>
        {onViewBudget && (
          <button
            onClick={onViewBudget}
            className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            View Budget
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center gap-6">
        {/* Circular Progress */}
        <div className="relative w-32 h-32 flex-shrink-0">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-[var(--ff-bg-tertiary)]"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="45"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              className={colors.text}
              style={{
                strokeDasharray: circumference,
                strokeDashoffset,
                transition: 'stroke-dashoffset 0.5s ease',
              }}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${colors.text}`}>
              {budget.utilizationPercent}%
            </span>
            <span className="text-xs text-[var(--ff-text-secondary)]">utilized</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-[var(--ff-text-secondary)]">Committed</span>
            <span className="text-sm font-medium text-[var(--ff-text-primary)]">
              R {budget.committedAmount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-[var(--ff-text-secondary)]">Actual Spent</span>
            <span className="text-sm font-medium text-[var(--ff-text-primary)]">
              R {budget.actualAmount.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-[var(--ff-border-light)]">
            <span className="text-sm text-[var(--ff-text-secondary)]">Available</span>
            <span className={`text-sm font-bold ${colors.text}`}>
              R {budget.availableBudget.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Health Status Badge */}
      <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${colors.bg}`} />
          <span className={`text-sm font-medium ${colors.text} capitalize`}>
            {budget.health}
          </span>
          {budget.health === 'critical' && (
            <span className="text-xs text-red-400 ml-2">Budget exceeded</span>
          )}
          {budget.health === 'warning' && (
            <span className="text-xs text-amber-400 ml-2">Approaching limit</span>
          )}
        </div>
      </div>
    </div>
  );
}
