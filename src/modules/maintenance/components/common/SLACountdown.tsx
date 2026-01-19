/**
 * SLACountdown Component - SLA countdown timer
 *
 * 🟢 WORKING: Production-ready SLA countdown component
 *
 * Features:
 * - Real-time countdown to SLA deadline
 * - Color-coded urgency indicators
 * - Breach status display
 * - Auto-updating timer
 * - Warning thresholds
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Clock, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { formatDistanceToNow, differenceInHours, differenceInMinutes, isPast } from 'date-fns';
import { cn } from '@/lib/utils';

interface SLACountdownProps {
  /** SLA due date */
  slaDueAt: Date | string | null;
  /** Is SLA breached */
  slaBreached?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Show detailed breakdown */
  detailed?: boolean;
}

/**
 * 🟢 WORKING: Get time remaining details
 */
function getTimeRemaining(dueDate: Date): {
  totalHours: number;
  totalMinutes: number;
  isPastDue: boolean;
  urgency: 'critical' | 'warning' | 'normal';
  label: string;
} {
  const now = new Date();
  const isPastDue = isPast(dueDate);
  const totalHours = Math.abs(differenceInHours(dueDate, now));
  const totalMinutes = Math.abs(differenceInMinutes(dueDate, now));

  let urgency: 'critical' | 'warning' | 'normal' = 'normal';

  if (isPastDue) {
    urgency = 'critical';
  } else if (totalHours < 2) {
    urgency = 'critical';
  } else if (totalHours < 24) {
    urgency = 'warning';
  }

  const label = formatDistanceToNow(dueDate, { addSuffix: !isPastDue });

  return {
    totalHours,
    totalMinutes,
    isPastDue,
    urgency,
    label,
  };
}

/**
 * 🟢 WORKING: SLA countdown component
 */
export function SLACountdown({
  slaDueAt,
  slaBreached = false,
  compact = false,
  detailed = false,
}: SLACountdownProps) {
  // Parse due date
  const dueDate = slaDueAt
    ? typeof slaDueAt === 'string'
      ? new Date(slaDueAt)
      : slaDueAt
    : null;

  // State for real-time updates
  const [timeRemaining, setTimeRemaining] = useState(
    dueDate ? getTimeRemaining(dueDate) : null
  );

  // 🟢 WORKING: Update countdown every minute
  useEffect(() => {
    if (!dueDate) return;

    // Update immediately
    setTimeRemaining(getTimeRemaining(dueDate));

    // Then update every minute
    const interval = setInterval(() => {
      setTimeRemaining(getTimeRemaining(dueDate));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [dueDate]);

  // 🟢 WORKING: No SLA set
  if (!dueDate || !timeRemaining) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
        <Clock className="w-3 h-3" />
        No SLA
      </span>
    );
  }

  // 🟢 WORKING: Get urgency-based styling
  const urgencyConfig = {
    critical: {
      color: 'bg-red-500/20 text-red-400 border-red-500/30',
      icon: timeRemaining.isPastDue ? XCircle : AlertTriangle,
    },
    warning: {
      color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      icon: AlertTriangle,
    },
    normal: {
      color: 'bg-green-500/20 text-green-400 border-green-500/30',
      icon: CheckCircle2,
    },
  };

  const config = urgencyConfig[timeRemaining.urgency];
  const Icon = config.icon;

  // 🟢 WORKING: Compact mode - simple badge
  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
          config.color
        )}
      >
        <Icon className="w-3 h-3" />
        {timeRemaining.isPastDue ? 'Overdue' : timeRemaining.label}
      </span>
    );
  }

  // 🟢 WORKING: Detailed mode - full card
  if (detailed) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className={cn('p-2 rounded-lg', config.color)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-1">
              {timeRemaining.isPastDue ? 'SLA Breached' : 'SLA Status'}
            </h4>
            <p className="text-xs text-[var(--ff-text-secondary)]">
              {timeRemaining.isPastDue
                ? `Overdue by ${timeRemaining.label}`
                : `Due ${timeRemaining.label}`}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {/* Time Remaining Breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-2 text-center">
              <p className="text-xl font-bold text-[var(--ff-text-primary)]">{timeRemaining.totalHours}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Hours</p>
            </div>
            <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-2 text-center">
              <p className="text-xl font-bold text-[var(--ff-text-primary)]">{timeRemaining.totalMinutes % 60}</p>
              <p className="text-xs text-[var(--ff-text-secondary)]">Minutes</p>
            </div>
          </div>

          {/* Due Date */}
          <div className="flex items-center gap-2 text-xs">
            <Clock className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
            <span className="text-[var(--ff-text-secondary)]">Due:</span>
            <span className="text-[var(--ff-text-primary)]">{dueDate.toLocaleString()}</span>
          </div>

          {/* Status Badge */}
          {timeRemaining.urgency === 'critical' && !timeRemaining.isPastDue && (
            <div className="flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">Urgent - less than 2 hours remaining</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Default mode - inline display
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
          config.color
        )}
      >
        <Icon className="w-3.5 h-3.5" />
        {timeRemaining.isPastDue ? (
          <span className="font-semibold">Overdue by {timeRemaining.label}</span>
        ) : (
          <>
            Due {timeRemaining.label}
            {timeRemaining.urgency === 'critical' && ' ⚠️'}
          </>
        )}
      </span>

      {/* Breach Badge */}
      {slaBreached && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-600/20 text-red-400 border border-red-600/30">
          <XCircle className="w-3 h-3" />
          SLA Breached
        </span>
      )}
    </div>
  );
}
