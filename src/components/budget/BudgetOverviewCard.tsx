/**
 * Budget Overview Card Component
 * PRD-057: Project Budget Tracking System
 *
 * Displays summary budget information including total, committed, and available amounts
 */

import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { BudgetHealth, BudgetStatus } from '@/types/budget';

interface BudgetOverviewCardProps {
  totalBudget: number;
  committedAmount: number;
  actualAmount: number;
  availableBudget: number;
  utilizationPercent: number;
  health: BudgetHealth;
  status: BudgetStatus;
  currency?: string;
  sourceType?: 'manual' | 'boq' | 'hybrid';
  onSyncBoq?: () => void;
  onAdjust?: () => void;
  canAdjust?: boolean;
}

const formatCurrency = (amount: number, currency = 'ZAR'): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getHealthIcon = (health: BudgetHealth) => {
  switch (health) {
    case 'healthy':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'warning':
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case 'critical':
      return <XCircle className="h-5 w-5 text-red-500" />;
    default:
      return null;
  }
};

const getHealthColor = (health: BudgetHealth): string => {
  switch (health) {
    case 'healthy':
      return 'bg-green-500';
    case 'warning':
      return 'bg-yellow-500';
    case 'critical':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

const getStatusBadgeClass = (status: BudgetStatus): string => {
  switch (status) {
    case 'approved':
      return 'bg-green-100 text-green-800';
    case 'locked':
      return 'bg-secondary text-foreground';
    case 'closed':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-blue-100 text-blue-800';
  }
};

export function BudgetOverviewCard({
  totalBudget,
  committedAmount,
  actualAmount,
  availableBudget,
  utilizationPercent,
  health,
  status,
  currency = 'ZAR',
  sourceType = 'manual',
  onSyncBoq,
  onAdjust,
  canAdjust = false,
}: BudgetOverviewCardProps) {
  return (
    <div
      className="bg-card rounded-lg border border-border shadow-sm"
      data-testid="budget-overview"
    >
      <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-foreground">Budget Overview</h3>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadgeClass(status)}`}>
            {status}
          </span>
        </div>
        <div className="flex items-center gap-2" data-testid="budget-health">
          {getHealthIcon(health)}
          <span className="text-sm capitalize">{health}</span>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Total Budget */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Total Budget</span>
            <span className="text-sm text-muted-foreground capitalize">
              Source: {sourceType}
            </span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(totalBudget, currency)}</p>
        </div>

        {/* Utilization Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Utilization</span>
            <span className="font-medium text-foreground">{utilizationPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${getHealthColor(health)}`}
              style={{ width: `${Math.min(utilizationPercent, 100)}%` }}
              role="progressbar"
              aria-valuenow={utilizationPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        {/* Budget Breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Committed</p>
            <p className="text-sm font-semibold text-foreground">{formatCurrency(committedAmount, currency)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Actual</p>
            <p className="text-sm font-semibold text-foreground">{formatCurrency(actualAmount, currency)}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Available</p>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatCurrency(availableBudget, currency)}
            </p>
          </div>
        </div>

        {/* Actions */}
        {(onSyncBoq || (canAdjust && onAdjust)) && (
          <div className="flex gap-2 pt-2">
            {onSyncBoq && sourceType !== 'manual' && (
              <button
                onClick={onSyncBoq}
                className="px-3 py-1.5 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/50"
              >
                Sync from BOQ
              </button>
            )}
            {canAdjust && onAdjust && (
              <button
                onClick={onAdjust}
                className="px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded-md hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                Adjust Budget
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default BudgetOverviewCard;
