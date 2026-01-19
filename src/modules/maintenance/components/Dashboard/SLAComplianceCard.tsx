/**
 * SLAComplianceCard Component - SLA Compliance Metrics Display
 *
 * 🟢 WORKING: Production-ready SLA compliance card component
 *
 * Features:
 * - Visual compliance gauge/indicator
 * - Color-coded status (green >= 90%, yellow 70-89%, red < 70%)
 * - Met vs breached breakdown
 * - Compliance percentage display
 * - Responsive layout
 */

'use client';

import React from 'react';
import { CheckCircle2, XCircle, TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLAComplianceCardProps {
  /** Total number of tickets */
  total: number;
  /** Number of tickets that met SLA */
  met: number;
  /** Number of tickets that breached SLA */
  breached: number;
  /** Compliance rate as percentage (0-100) */
  complianceRate: number;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

/**
 * 🟢 WORKING: SLA compliance metrics card component
 */
export function SLAComplianceCard({
  total,
  met,
  breached,
  complianceRate,
  compact = false,
}: SLAComplianceCardProps) {
  // 🟢 WORKING: Determine status color based on compliance rate
  const getStatusColor = (rate: number): 'green' | 'yellow' | 'red' => {
    if (rate >= 90) return 'green';
    if (rate >= 70) return 'yellow';
    return 'red';
  };

  const statusColor = getStatusColor(complianceRate);

  // 🟢 WORKING: Color classes for different statuses
  const colorClasses = {
    green: {
      border: 'border-green-500/20',
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      iconBg: 'bg-green-500/10',
    },
    yellow: {
      border: 'border-yellow-500/20',
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-400',
      iconBg: 'bg-yellow-500/10',
    },
    red: {
      border: 'border-red-500/20',
      bg: 'bg-red-500/10',
      text: 'text-red-400',
      iconBg: 'bg-red-500/10',
    },
  };

  const colors = colorClasses[statusColor];

  return (
    <div className={cn('bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6', compact && 'p-4')}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">SLA Compliance</h2>
        <div className={cn('p-2 rounded-lg', colors.iconBg)}>
          {statusColor === 'green' && <TrendingUp className={cn('w-5 h-5', colors.text)} />}
          {statusColor === 'yellow' && <AlertTriangle className={cn('w-5 h-5', colors.text)} />}
          {statusColor === 'red' && <XCircle className={cn('w-5 h-5', colors.text)} />}
        </div>
      </div>

      {/* Compliance Rate Gauge */}
      <div className="mb-6">
        <div className="flex items-baseline gap-2 mb-2">
          <span className={cn('text-4xl font-bold', colors.text)}>
            {complianceRate.toFixed(0)}%
          </span>
          <span className="text-sm text-[var(--ff-text-secondary)]">compliance rate</span>
        </div>

        {/* Progress bar */}
        <div className="relative h-3 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
          <div
            className={cn(
              'absolute inset-y-0 left-0 rounded-full transition-all duration-300',
              statusColor === 'green' && 'bg-green-500',
              statusColor === 'yellow' && 'bg-yellow-500',
              statusColor === 'red' && 'bg-red-500'
            )}
            style={{ width: `${Math.min(complianceRate, 100)}%` }}
          />
        </div>
      </div>

      {/* Met vs Breached Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        {/* SLA Met */}
        <div className={cn('p-3 rounded-lg border', 'border-green-500/20', 'bg-green-500/5')}>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <p className="text-xs text-[var(--ff-text-secondary)]">SLA Met</p>
          </div>
          <p className="text-2xl font-bold text-green-400">{met}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {total > 0 ? ((met / total) * 100).toFixed(1) : 0}% of total
          </p>
        </div>

        {/* SLA Breached */}
        <div className={cn('p-3 rounded-lg border', 'border-red-500/20', 'bg-red-500/5')}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-400" />
            <p className="text-xs text-[var(--ff-text-secondary)]">SLA Breached</p>
          </div>
          <p className="text-2xl font-bold text-red-400">{breached}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
            {total > 0 ? ((breached / total) * 100).toFixed(1) : 0}% of total
          </p>
        </div>
      </div>

      {/* Total Count */}
      <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
        <p className="text-sm text-[var(--ff-text-secondary)]">
          Total tickets analyzed: <span className="font-medium text-[var(--ff-text-primary)]">{total}</span>
        </p>
      </div>
    </div>
  );
}
