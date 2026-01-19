/**
 * GuaranteeIndicator Component - Guarantee status indicator
 *
 * 🟢 WORKING: Production-ready guarantee indicator component
 *
 * Features:
 * - Display guarantee status with color coding
 * - Show guarantee expiry date
 * - Billable status indicator
 * - Billing classification display
 * - Visual badges and tooltips
 */

'use client';

import React from 'react';
import { Shield, ShieldAlert, ShieldX, DollarSign, Calendar } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { GuaranteeStatus } from '../../types/ticket';

interface GuaranteeIndicatorProps {
  /** Guarantee status */
  guaranteeStatus: GuaranteeStatus | string | null;
  /** Guarantee expiry date */
  guaranteeExpiresAt?: Date | string | null;
  /** Is billable */
  isBillable?: boolean | null;
  /** Billing classification */
  billingClassification?: string | null;
  /** Show detailed info */
  detailed?: boolean;
  /** Compact mode */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Get guarantee status config
 */
function getGuaranteeConfig(status: GuaranteeStatus | string | null) {
  const configs: Record<
    string,
    {
      label: string;
      icon: React.ElementType;
      color: string;
      description: string;
    }
  > = {
    under_guarantee: {
      label: 'Under Guarantee',
      icon: Shield,
      color: 'bg-green-500/20 text-green-400 border-green-500/30',
      description: 'Work covered under guarantee period',
    },
    out_of_guarantee: {
      label: 'Out of Guarantee',
      icon: ShieldX,
      color: 'bg-red-500/20 text-red-400 border-red-500/30',
      description: 'Guarantee period has expired',
    },
    pending_classification: {
      label: 'Pending Classification',
      icon: ShieldAlert,
      color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      description: 'Guarantee status needs to be classified',
    },
  };

  if (!status) {
    return {
      label: 'Not Classified',
      icon: ShieldAlert,
      color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      description: 'Guarantee status not set',
    };
  }

  return (
    configs[status] || {
      label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      icon: Shield,
      color: 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)]',
      description: 'Unknown guarantee status',
    }
  );
}

/**
 * 🟢 WORKING: Guarantee indicator component
 */
export function GuaranteeIndicator({
  guaranteeStatus,
  guaranteeExpiresAt,
  isBillable,
  billingClassification,
  detailed = false,
  compact = false,
}: GuaranteeIndicatorProps) {
  const config = getGuaranteeConfig(guaranteeStatus);
  const Icon = config.icon;

  // Parse expiry date if provided as string
  const expiryDate = guaranteeExpiresAt
    ? typeof guaranteeExpiresAt === 'string'
      ? new Date(guaranteeExpiresAt)
      : guaranteeExpiresAt
    : null;

  // Check if expired
  const isExpired = expiryDate && expiryDate < new Date();

  // 🟢 WORKING: Compact mode - simple badge
  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
          config.color
        )}
        title={config.description}
      >
        <Icon className="w-3 h-3" />
        <span>{config.label}</span>
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
            <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-1">{config.label}</h4>
            <p className="text-xs text-[var(--ff-text-secondary)]">{config.description}</p>
          </div>
        </div>

        <div className="space-y-2">
          {/* Expiry Date */}
          {expiryDate && (
            <div className="flex items-center gap-2 text-xs">
              <Calendar className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Expires:</span>
              <span className={cn('text-[var(--ff-text-primary)]', isExpired && 'text-red-400')}>
                {isExpired ? 'Expired ' : ''}
                {formatDistanceToNow(expiryDate, { addSuffix: !isExpired })}
              </span>
            </div>
          )}

          {/* Billable Status */}
          {isBillable !== null && isBillable !== undefined && (
            <div className="flex items-center gap-2 text-xs">
              <DollarSign className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Billable:</span>
              <span
                className={cn(
                  'px-2 py-0.5 rounded font-medium',
                  isBillable
                    ? 'bg-orange-500/20 text-orange-400'
                    : 'bg-green-500/20 text-green-400'
                )}
              >
                {isBillable ? 'Yes' : 'No'}
              </span>
            </div>
          )}

          {/* Billing Classification */}
          {billingClassification && (
            <div className="flex items-center gap-2 text-xs">
              <DollarSign className="w-3 h-3 text-[var(--ff-text-tertiary)]" />
              <span className="text-[var(--ff-text-secondary)]">Classification:</span>
              <span className="text-[var(--ff-text-primary)] capitalize">
                {billingClassification.replace(/_/g, ' ')}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Default mode - inline display
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Guarantee Badge */}
      <span
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border',
          config.color
        )}
        title={config.description}
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{config.label}</span>
      </span>

      {/* Expiry Info */}
      {expiryDate && (
        <span className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
          <Calendar className="w-3 h-3" />
          {isExpired ? (
            <span className="text-red-400">
              Expired {formatDistanceToNow(expiryDate, { addSuffix: true })}
            </span>
          ) : (
            <span>Expires {formatDistanceToNow(expiryDate, { addSuffix: true })}</span>
          )}
        </span>
      )}

      {/* Billable Badge */}
      {isBillable !== null && isBillable !== undefined && (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium',
            isBillable
              ? 'bg-orange-500/20 text-orange-400'
              : 'bg-green-500/20 text-green-400'
          )}
        >
          <DollarSign className="w-3 h-3" />
          {isBillable ? 'Billable' : 'Not Billable'}
        </span>
      )}
    </div>
  );
}
