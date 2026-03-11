/**
 * EscalationAlert Component - Display alert for repeat fault escalations
 *
 * 🟢 WORKING: Production-ready escalation alert component
 *
 * Features:
 * - Show escalation severity (critical, high, medium)
 * - Display scope type and value (pole, PON, zone, DR)
 * - Show fault count and threshold
 * - Display recommended actions
 * - Link to escalation detail
 * - Dismissible alerts
 * - Color-coded by severity
 * - Responsive design
 */

'use client';

import React, { useCallback } from 'react';
import { AlertTriangle, AlertCircle, Info, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepeatFaultAlert, EscalationScopeType } from '../../types/escalation';

interface EscalationAlertProps {
  /** Alert data to display */
  alert: RepeatFaultAlert;
  /** Callback when alert is dismissed */
  onDismiss?: (escalationId: string) => void;
  /** Callback when alert is clicked */
  onClick?: (escalationId: string) => void;
  /** Whether alert is dismissible */
  dismissible?: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Get icon for severity level
 */
function getSeverityIcon(severity: 'critical' | 'high' | 'medium') {
  switch (severity) {
    case 'critical':
      return <AlertTriangle className="w-5 h-5" />;
    case 'high':
      return <AlertCircle className="w-5 h-5" />;
    case 'medium':
      return <Info className="w-5 h-5" />;
    default:
      return <Info className="w-5 h-5" />;
  }
}

/**
 * 🟢 WORKING: Get styles for severity level
 */
function getSeverityStyles(severity: 'critical' | 'high' | 'medium'): {
  container: string;
  icon: string;
  badge: string;
} {
  switch (severity) {
    case 'critical':
      return {
        container: 'bg-red-500/10 border-red-500/30',
        icon: 'text-red-400',
        badge: 'bg-red-500/20 text-red-400 border-red-500/30',
      };
    case 'high':
      return {
        container: 'bg-orange-500/10 border-orange-500/30',
        icon: 'text-orange-400',
        badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      };
    case 'medium':
      return {
        container: 'bg-yellow-500/10 border-yellow-500/30',
        icon: 'text-yellow-400',
        badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      };
    default:
      return {
        container: 'bg-blue-500/10 border-blue-500/30',
        icon: 'text-blue-400',
        badge: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      };
  }
}

/**
 * 🟢 WORKING: Format scope label
 */
function formatScopeLabel(scopeType: EscalationScopeType): string {
  const labels: Record<EscalationScopeType, string> = {
    pole: 'Pole',
    pon: 'PON',
    zone: 'Zone',
    dr: 'DR Number',
  };
  return labels[scopeType] || scopeType;
}

/**
 * 🟢 WORKING: Format timestamp
 */
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * 🟢 WORKING: Escalation alert component
 */
export function EscalationAlert({
  alert,
  onDismiss,
  onClick,
  dismissible = true,
  compact = false,
}: EscalationAlertProps) {
  const styles = getSeverityStyles(alert.severity);

  // 🟢 WORKING: Handle dismiss click
  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDismiss) {
        onDismiss(alert.escalation_id);
      }
    },
    [alert.escalation_id, onDismiss]
  );

  // 🟢 WORKING: Handle alert click
  const handleClick = useCallback(() => {
    if (onClick) {
      onClick(alert.escalation_id);
    }
  }, [alert.escalation_id, onClick]);

  return (
    <div
      className={cn(
        'rounded-lg border p-4 transition-all',
        styles.container,
        onClick && 'cursor-pointer hover:shadow-lg',
        compact && 'p-3'
      )}
      onClick={onClick ? handleClick : undefined}
      role={onClick ? 'button' : 'article'}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-start">
        {/* Icon */}
        <div className={cn('flex-shrink-0 mt-0.5', styles.icon)}>
          {getSeverityIcon(alert.severity)}
        </div>

        {/* Content */}
        <div className="ml-3 flex-1">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              {/* Severity badge */}
              <span
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border mb-2',
                  styles.badge
                )}
              >
                {alert.severity.toUpperCase()}
              </span>

              {/* Message */}
              <h3
                className={cn(
                  'font-semibold text-[var(--ff-text-primary)]',
                  compact ? 'text-sm' : 'text-base'
                )}
              >
                {alert.message}
              </h3>
            </div>

            {/* Dismiss button */}
            {dismissible && onDismiss && (
              <button
                onClick={handleDismiss}
                className="ml-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors flex-shrink-0"
                aria-label="Dismiss alert"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Details */}
          <div
            className={cn(
              'mt-2 space-y-1 text-[var(--ff-text-primary)]',
              compact ? 'text-xs' : 'text-sm'
            )}
          >
            <div className="flex items-center space-x-4">
              <span className="font-medium">
                {formatScopeLabel(alert.scope_type)}: {alert.scope_value}
              </span>
              <span className="text-[var(--ff-text-secondary)]">•</span>
              <span>
                {alert.fault_count} fault{alert.fault_count !== 1 ? 's' : ''} detected
              </span>
              <span className="text-[var(--ff-text-secondary)]">•</span>
              <span className="text-[var(--ff-text-secondary)]">{formatTime(alert.created_at)}</span>
            </div>
          </div>

          {/* Recommended action */}
          {!compact && alert.recommended_action && (
            <div className="mt-3 p-3 bg-black/20 rounded-lg">
              <p className="text-xs text-[var(--ff-text-primary)]">
                <span className="font-semibold">Recommended Action:</span>{' '}
                {alert.recommended_action}
              </p>
            </div>
          )}

          {/* View details link */}
          {onClick && !compact && (
            <div className="mt-3 flex items-center text-xs text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors">
              <span>View escalation details</span>
              <ExternalLink className="w-3 h-3 ml-1" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
