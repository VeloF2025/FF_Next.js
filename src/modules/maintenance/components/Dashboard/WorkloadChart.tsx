/**
 * WorkloadChart Component - Workload Distribution Display
 *
 * 🟢 WORKING: Production-ready workload distribution chart component
 *
 * Features:
 * - Visual bar chart of workload by assignee
 * - Ticket counts per assignee
 * - Overdue ticket indicators
 * - Sorted by ticket count (descending)
 * - Handles unassigned tickets
 * - Empty state handling
 * - Responsive layout
 */

'use client';

import React from 'react';
import { Users, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkloadByAssignee } from '../../services/dashboardService';

interface WorkloadChartProps {
  /** Workload data by assignee */
  data: WorkloadByAssignee[];
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Maximum number of assignees to show */
  maxItems?: number;
}

/**
 * 🟢 WORKING: Workload distribution chart component
 */
export function WorkloadChart({ data, compact = false, maxItems = 10 }: WorkloadChartProps) {
  // 🟢 WORKING: Handle empty data
  if (!data || data.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Workload Distribution</h2>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Users className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No workload data available</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">No tickets have been assigned yet</p>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Sort and limit data
  const sortedData = [...data]
    .sort((a, b) => b.ticket_count - a.ticket_count)
    .slice(0, maxItems);

  // 🟢 WORKING: Calculate max count for chart scaling
  const maxCount = Math.max(...sortedData.map((item) => item.ticket_count), 1);

  return (
    <div className={cn('bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6', compact && 'p-4')}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Workload Distribution</h2>
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
          <Users className="w-4 h-4" />
          <span>{sortedData.length} assignees</span>
        </div>
      </div>

      {/* Chart */}
      <div className="space-y-3">
        {sortedData.map((item, index) => {
          const barWidth = (item.ticket_count / maxCount) * 100;
          const hasOverdue = item.overdue_count > 0;

          return (
            <div key={item.assigned_to || 'unassigned'} className="space-y-1">
              {/* Assignee Name and Count */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-[var(--ff-text-primary)] truncate">
                    {item.assignee_name || 'Unassigned'}
                  </span>
                  {hasOverdue && (
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <AlertCircle className="w-3 h-3" />
                      <span>{item.overdue_count} overdue</span>
                    </span>
                  )}
                </div>
                <span className="font-medium text-[var(--ff-text-primary)] ml-2">{item.ticket_count}</span>
              </div>

              {/* Progress Bar */}
              <div className="relative h-8 bg-[var(--ff-bg-tertiary)] rounded-lg overflow-hidden">
                <div
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-lg transition-all duration-300',
                    hasOverdue
                      ? 'bg-gradient-to-r from-red-500/80 to-red-500/60'
                      : 'bg-gradient-to-r from-blue-500/80 to-blue-500/60'
                  )}
                  style={{ width: `${barWidth}%` }}
                />

                {/* Count Label (shown if bar is wide enough) */}
                {barWidth > 15 && (
                  <div className="absolute inset-0 flex items-center px-3">
                    <span className="text-xs font-medium text-white">
                      {item.ticket_count} ticket{item.ticket_count !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center gap-4 text-xs text-[var(--ff-text-secondary)]">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500/80 rounded" />
            <span>Active tickets</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-red-500/80 rounded" />
            <span>Has overdue</span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-3 text-sm text-[var(--ff-text-secondary)]">
        Total active tickets:{' '}
        <span className="font-medium text-[var(--ff-text-primary)]">
          {sortedData.reduce((sum, item) => sum + item.ticket_count, 0)}
        </span>
      </div>
    </div>
  );
}
