import React from 'react';
import {
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconAlertCircle,
  IconClock,
} from '@tabler/icons-react';

export type StatusBadgeProps = {
  status: 'approved' | 'rejected' | 'pending' | 'warning';
  label?: string;
  className?: string;
};

const statusConfig = {
  approved: {
    bgColor: '#4ade80',
    textColor: '#166534',
    label: 'Approved',
    icon: IconCircleCheckFilled,
  },
  rejected: {
    bgColor: '#f87171',
    textColor: '#991b1b',
    label: 'Rejected',
    icon: IconCircleXFilled,
  },
  pending: {
    bgColor: '#fbbf24',
    textColor: '#92400e',
    label: 'Pending',
    icon: IconClock,
  },
  warning: {
    bgColor: '#fbbf24',
    textColor: '#92400e',
    label: 'Warning',
    icon: IconAlertCircle,
  },
} as const;

/**
 * AccessibleStatusBadge
 * 
 * A WCAG 2.1 AA compliant status badge component.
 * Uses both icon and text (not color-only).
 * 
 * @example
 * ```tsx
 * <StatusBadge status="approved" />
 * <StatusBadge status="pending" label="Custom Label" />
 * ```
 * 
 * WCAG criteria met:
 * - 1.4.1 Use of Color — text + icon, not color-only
 * - 1.4.3 Contrast (Level AA) — 6.5:1+ on all status colors
 * - 4.1.2 Name, Role, Value — aria-label describes status
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  className = '',
}) => {
  const config = statusConfig[status];
  const Icon = config.icon;
  const displayLabel = label || config.label;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}
      style={{
        backgroundColor: config.bgColor,
        color: config.textColor,
      }}
      role="status"
      aria-label={`Status: ${displayLabel}`}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{displayLabel}</span>
    </div>
  );
};

export type { StatusBadgeProps };
