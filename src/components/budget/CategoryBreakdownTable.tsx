/**
 * Category Breakdown Table Component
 * PRD-057: Project Budget Tracking System
 *
 * Displays budget categories with allocated, committed, actual, and available amounts
 */

import React from 'react';
import { Pencil } from 'lucide-react';
import type { BudgetCategory } from '@/types/budget';

interface CategoryBreakdownTableProps {
  categories: BudgetCategory[];
  currency?: string;
  onEditCategory?: (category: BudgetCategory) => void;
  canEdit?: boolean;
}

const formatCurrency = (amount: number, currency = 'ZAR'): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const getUtilizationColor = (percent: number): string => {
  if (percent >= 100) return 'bg-red-500';
  if (percent >= 80) return 'bg-yellow-500';
  return 'bg-green-500';
};

export function CategoryBreakdownTable({
  categories,
  currency = 'ZAR',
  onEditCategory,
  canEdit = false,
}: CategoryBreakdownTableProps) {
  const calculateUtilization = (category: BudgetCategory): number => {
    if (!category.allocatedAmount || category.allocatedAmount === 0) return 0;
    return (category.committedAmount / category.allocatedAmount) * 100;
  };

  // Calculate totals
  const totals = categories.reduce(
    (acc, cat) => ({
      allocated: acc.allocated + (cat.allocatedAmount || 0),
      committed: acc.committed + (cat.committedAmount || 0),
      actual: acc.actual + (cat.actualAmount || 0),
      available: acc.available + (cat.availableAmount || 0),
    }),
    { allocated: 0, committed: 0, actual: 0, available: 0 }
  );

  return (
    <div
      className="bg-card rounded-lg border border-border shadow-sm"
      data-testid="category-breakdown"
    >
      <div className="p-4 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-foreground">Category Breakdown</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-background">
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">Category</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Allocated</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Committed</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actual</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground">Available</th>
              <th className="py-3 px-4 font-medium text-muted-foreground w-32">Utilization</th>
              {canEdit && <th className="py-3 px-4 w-12"></th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => {
              const utilization = calculateUtilization(category);
              return (
                <tr
                  key={category.id}
                  className="border-b border-border hover:bg-accent/50"
                  data-testid="budget-category"
                >
                  <td className="py-3 px-4">
                    <div className="flex flex-col">
                      <span className="font-medium text-foreground">{category.categoryName}</span>
                      <span className="text-xs text-muted-foreground">
                        {category.categoryCode}
                      </span>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4 text-muted-foreground">
                    {formatCurrency(category.allocatedAmount || 0, currency)}
                  </td>
                  <td className="text-right py-3 px-4 text-muted-foreground">
                    {formatCurrency(category.committedAmount || 0, currency)}
                  </td>
                  <td className="text-right py-3 px-4 text-muted-foreground">
                    {formatCurrency(category.actualAmount || 0, currency)}
                  </td>
                  <td className="text-right py-3 px-4 text-green-600 dark:text-green-400 font-medium">
                    {formatCurrency(category.availableAmount || 0, currency)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${getUtilizationColor(utilization)}`}
                          style={{ width: `${Math.min(utilization, 100)}%` }}
                          role="progressbar"
                          aria-valuenow={utilization}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                      <span className="text-xs w-10 text-right text-muted-foreground">
                        {utilization.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  {canEdit && (
                    <td className="py-3 px-4">
                      <button
                        onClick={() => onEditCategory?.(category)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold bg-background">
              <td className="py-3 px-4 text-foreground">Total</td>
              <td className="text-right py-3 px-4 text-foreground">
                {formatCurrency(totals.allocated, currency)}
              </td>
              <td className="text-right py-3 px-4 text-foreground">
                {formatCurrency(totals.committed, currency)}
              </td>
              <td className="text-right py-3 px-4 text-foreground">
                {formatCurrency(totals.actual, currency)}
              </td>
              <td className="text-right py-3 px-4 text-green-600 dark:text-green-400">
                {formatCurrency(totals.available, currency)}
              </td>
              <td className="py-3 px-4"></td>
              {canEdit && <td className="py-3 px-4"></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default CategoryBreakdownTable;
