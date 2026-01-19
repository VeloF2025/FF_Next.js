/**
 * TicketListItem Component - Individual ticket list item
 *
 * 🟢 WORKING: Production-ready ticket list item component
 *
 * Features:
 * - Display ticket information in list format
 * - Status and priority badges
 * - Relative time display
 * - Clickable for navigation
 * - QA ready indicator
 * - SLA breach warning
 * - Compact mode support
 */

'use client';

import React from 'react';
import Link from 'next/link';
import {
  Clock,
  MapPin,
  User,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { TicketStatusBadge } from './TicketStatusBadge';
import type { Ticket } from '../../types/ticket';

interface TicketListItemProps {
  /** Ticket data */
  ticket: Ticket;
  /** Compact mode */
  compact?: boolean;
  /** Custom click handler (overrides default link) */
  onClick?: (ticket: Ticket) => void;
}

/**
 * 🟢 WORKING: Get priority badge styling
 */
function getPriorityBadgeStyle(priority: string): string {
  const priorityColors: Record<string, string> = {
    low: 'text-gray-400',
    normal: 'text-blue-400',
    high: 'text-orange-400',
    urgent: 'text-red-400',
    critical: 'text-red-500 font-bold',
  };

  return priorityColors[priority] || 'text-[var(--ff-text-secondary)]';
}

/**
 * 🟢 WORKING: Ticket list item component
 */
export function TicketListItem({ ticket, compact = false, onClick }: TicketListItemProps) {
  const content = (
    <div className="flex items-start justify-between gap-3">
      {/* Left side: Ticket info */}
      <div className="flex-1 min-w-0">
        {/* Ticket UID and Priority */}
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-mono text-sm font-medium text-blue-400">
            {ticket.ticket_uid}
          </span>
          <span className={cn('text-xs font-medium uppercase', getPriorityBadgeStyle(ticket.priority))}>
            {ticket.priority}
          </span>

          {/* QA Ready Indicator */}
          {ticket.qa_ready && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
              <CheckCircle2 className="w-3 h-3" />
              QA Ready
            </span>
          )}

          {/* SLA Breach Warning */}
          {ticket.sla_breached && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
              <AlertTriangle className="w-3 h-3" />
              SLA Breach
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-[var(--ff-text-primary)] font-medium mb-2 line-clamp-1">
          {ticket.title}
        </h3>

        {/* Meta Information */}
        <div className="flex items-center gap-3 flex-wrap text-xs text-[var(--ff-text-secondary)]">
          {/* Status Badge */}
          <TicketStatusBadge status={ticket.status} compact showIcon={false} />

          {/* DR Number */}
          {ticket.dr_number && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {ticket.dr_number}
            </span>
          )}

          {/* Assigned To */}
          {ticket.assigned_to && (
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              Assigned
            </span>
          )}

          {/* Created Time */}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Fault Cause (if maintenance ticket) */}
        {ticket.ticket_type === 'maintenance' && ticket.fault_cause && (
          <div className="mt-2 text-xs text-[var(--ff-text-tertiary)]">
            <span className="capitalize">{ticket.fault_cause.replace(/_/g, ' ')}</span>
          </div>
        )}
      </div>

      {/* Right side: Action icon */}
      <ArrowRight className="w-5 h-5 text-[var(--ff-text-tertiary)] flex-shrink-0 mt-1" />
    </div>
  );

  // If custom onClick is provided, render as button
  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(ticket)}
        className={cn(
          'block w-full text-left bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors',
          compact ? 'p-3' : 'p-4'
        )}
      >
        {content}
      </button>
    );
  }

  // Default: render as link
  return (
    <Link
      href={`/ticketing/tickets/${ticket.id}`}
      className={cn(
        'block bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)] transition-colors',
        compact ? 'p-3' : 'p-4'
      )}
    >
      {content}
    </Link>
  );
}
