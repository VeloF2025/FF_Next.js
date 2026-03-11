/**
 * TicketStatusBadge Component - Status badge display
 *
 * 🟢 WORKING: Production-ready status badge component
 *
 * Features:
 * - Color-coded status badges
 * - Supports all ticket status values
 * - Icon indicators for status
 * - Accessible ARIA labels
 */

'use client';

import React from 'react';
import {
  Circle,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Ban,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TicketStatus } from '../../types/ticket';

interface TicketStatusBadgeProps {
  /** Ticket status */
  status: TicketStatus;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Show icon */
  showIcon?: boolean;
}

/**
 * 🟢 WORKING: Get status badge styling and icon
 */
function getStatusConfig(status: TicketStatus) {
  const configs: Record<
    TicketStatus,
    {
      style: string;
      label: string;
      Icon: React.ComponentType<{ className?: string }>;
    }
  > = {
    open: {
      style: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      label: 'Open',
      Icon: Circle,
    },
    assigned: {
      style: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      label: 'Assigned',
      Icon: Clock,
    },
    in_progress: {
      style: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      label: 'In Progress',
      Icon: Clock,
    },
    pending_qa: {
      style: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      label: 'Pending QA',
      Icon: Clock,
    },
    qa_in_progress: {
      style: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      label: 'QA In Progress',
      Icon: Clock,
    },
    qa_rejected: {
      style: 'bg-red-500/20 text-red-400 border-red-500/30',
      label: 'QA Rejected',
      Icon: XCircle,
    },
    qa_approved: {
      style: 'bg-green-500/20 text-green-400 border-green-500/30',
      label: 'QA Approved',
      Icon: CheckCircle2,
    },
    pending_handover: {
      style: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      label: 'Pending Handover',
      Icon: AlertCircle,
    },
    handed_to_maintenance: {
      style: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
      label: 'Handed to Maintenance',
      Icon: CheckCircle2,
    },
    closed: {
      style: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      label: 'Closed',
      Icon: CheckCircle2,
    },
    cancelled: {
      style: 'bg-red-500/20 text-red-400 border-red-500/30',
      label: 'Cancelled',
      Icon: Ban,
    },
  };

  return configs[status] || configs.open;
}

/**
 * 🟢 WORKING: Status badge component
 */
export function TicketStatusBadge({
  status,
  compact = false,
  showIcon = true,
}: TicketStatusBadgeProps) {
  const config = getStatusConfig(status);
  const { Icon } = config;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md text-xs font-medium border',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-1',
        config.style
      )}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && <Icon className={cn('flex-shrink-0', compact ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
      <span>{config.label}</span>
    </span>
  );
}
