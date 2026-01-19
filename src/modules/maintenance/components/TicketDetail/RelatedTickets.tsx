/**
 * RelatedTickets Component - Shows tickets with the same DR number
 *
 * Displays related tickets (same customer/location) in a sidebar panel.
 * Helps track history of tickets for the same DR number.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { RefreshCw, Link2, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRelatedTickets } from '../../hooks/useRelatedTickets';
import { TicketStatusBadge } from '../TicketList/TicketStatusBadge';
import type { TicketStatus } from '../../types/ticket';

interface RelatedTicketsProps {
  /** Current ticket ID (excluded from related list) */
  ticketId: string;
  /** DR number to find related tickets */
  drNumber: string | null | undefined;
  /** Compact display mode */
  compact?: boolean;
}

/**
 * Format date to readable string
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-ZA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

export function RelatedTickets({
  ticketId,
  drNumber,
  compact = false,
}: RelatedTicketsProps) {
  const { relatedTickets, isLoading, isError, refetch } = useRelatedTickets(
    ticketId,
    drNumber
  );

  // Don't render if no DR number
  if (!drNumber) {
    return null;
  }

  return (
    <div
      className={cn(
        'bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)]',
        compact ? 'p-3' : 'p-4'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <h3
            className={cn(
              'font-semibold text-[var(--ff-text-primary)]',
              compact ? 'text-sm' : 'text-base'
            )}
          >
            Related Tickets
            {!isLoading && relatedTickets.length > 0 && (
              <span className="ml-1.5 text-[var(--ff-text-tertiary)] font-normal">
                ({relatedTickets.length})
              </span>
            )}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isLoading}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            'text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)]',
            'hover:bg-[var(--ff-bg-secondary)]',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
          title="Refresh related tickets"
        >
          <RefreshCw
            className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')}
          />
        </button>
      </div>

      {/* Subtitle - DR number */}
      <p className="text-xs text-[var(--ff-text-tertiary)] mb-3">
        Same DR: <span className="font-mono text-[var(--ff-text-secondary)]">{drNumber}</span>
      </p>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--ff-text-tertiary)]" />
        </div>
      )}

      {/* Error State */}
      {isError && !isLoading && (
        <div className="flex items-center gap-2 py-3 px-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-xs text-red-400">Failed to load related tickets</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !isError && relatedTickets.length === 0 && (
        <div className="py-4 text-center">
          <p className="text-sm text-[var(--ff-text-tertiary)]">
            No other tickets for this DR
          </p>
        </div>
      )}

      {/* Related Tickets List */}
      {!isLoading && !isError && relatedTickets.length > 0 && (
        <div className="space-y-2">
          {relatedTickets.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/ticketing/tickets/${ticket.id}`}
              className={cn(
                'block p-3 rounded-lg transition-colors',
                'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)]',
                'border border-transparent hover:border-[var(--ff-border-light)]'
              )}
            >
              {/* Ticket UID and Title */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-blue-400">
                      {ticket.ticket_uid}
                    </span>
                    {ticket.external_id && (
                      <span className="text-xs text-[var(--ff-text-tertiary)]">
                        FT{ticket.external_id}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--ff-text-primary)] truncate mt-0.5">
                    {ticket.title}
                  </p>
                </div>
              </div>

              {/* Status and Date */}
              <div className="flex items-center justify-between gap-2">
                <TicketStatusBadge status={ticket.status as TicketStatus} compact />
                <span className="text-xs text-[var(--ff-text-tertiary)]">
                  {formatDate(ticket.created_at)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
