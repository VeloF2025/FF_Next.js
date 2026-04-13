/**
 * RecentTickets Component - Recent Tickets List Display
 *
 * 🟢 WORKING: Production-ready recent tickets list component
 *
 * Features:
 * - Display recent tickets in a list
 * - Show ticket UID, title, status, priority
 * - Relative time display
 * - Clickable ticket items
 * - Status and priority badges
 * - Empty state handling
 * - Configurable limit
 */

'use client';

import { Clock, FileText, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { RecentTicket } from '../../services/dashboardService';

interface RecentTicketsProps {
  /** Recent tickets data */
  tickets: RecentTicket[];
  /** Maximum number of tickets to display */
  limit?: number;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Show view all link */
  showViewAll?: boolean;
}

/**
 * Get status badge styling
 */
function getStatusBadgeStyle(status: string): string {
  const statusColors: Record<string, string> = {
    open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    assigned: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    in_progress: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pending_qa: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    qa_review: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    qa_approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    closed: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
  };

  return statusColors[status] || 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]';
}

/**
 * Get priority badge styling
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
 * 🟢 WORKING: Recent tickets list component
 */
export function RecentTickets({
  tickets,
  limit = 10,
  compact = false,
  showViewAll = true,
}: RecentTicketsProps) {

  // 🟢 WORKING: Handle empty state
  if (!tickets || tickets.length === 0) {
    return (
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Tickets</h2>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" />
          <p className="text-[var(--ff-text-secondary)]">No recent tickets</p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">New tickets will appear here</p>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Limit tickets display
  const displayTickets = tickets.slice(0, limit);

  return (
    <div className={cn('bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6', compact && 'p-4')}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Recent Tickets</h2>
        <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
          <FileText className="w-4 h-4" />
          <span>{displayTickets.length} tickets</span>
        </div>
      </div>

      {/* Tickets List */}
      <ul className="space-y-3" role="list">
        {displayTickets.map((ticket) => (
          <li key={ticket.id} role="listitem">
            <a
              href={`/noc/tickets/${ticket.id}`}
              className="block bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg p-4 hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
            <div className="flex items-start justify-between gap-3">
              {/* Left side: Ticket info */}
              <div className="flex-1 min-w-0">
                {/* Ticket UID and Priority */}
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm font-medium text-blue-400">
                    {ticket.ticket_uid}
                  </span>
                  <span className={cn('text-xs font-medium', getPriorityBadgeStyle(ticket.priority))}>
                    {ticket.priority.toUpperCase()}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-[var(--ff-text-primary)] font-medium mb-2 line-clamp-1">
                  {ticket.title}
                </h3>

                {/* Status and Time */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Status Badge */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
                      getStatusBadgeStyle(ticket.status)
                    )}
                  >
                    {ticket.status.replace(/_/g, ' ')}
                  </span>

                  {/* Created Time */}
                  <span className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)]">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
                  </span>
                </div>
              </div>

              {/* Right side: Action icon */}
              <ArrowRight className="w-5 h-5 text-[var(--ff-text-tertiary)] flex-shrink-0" />
            </div>
            </a>
          </li>
        ))}
      </ul>

      {/* Show More Link */}
      {showViewAll && tickets.length > limit && (
        <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)] text-center">
          <a
            href="/noc/tickets"
            className="text-sm text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 font-medium transition-colors inline-flex items-center gap-1"
          >
            View all {tickets.length} tickets
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      )}
    </div>
  );
}
