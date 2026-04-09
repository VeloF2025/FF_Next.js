/**
 * NearbyTickets Component - Shows tickets within 100m of current ticket GPS
 *
 * Displays nearby tickets in a sidebar panel below Related Tickets.
 * Helps field teams see other open tickets they can attend to at the same time.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { RefreshCw, MapPin, AlertCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { cn } from '@/lib/utils';
import { useNearbyTickets } from '../../hooks/useNearbyTickets';
import { TicketStatusBadge } from '../TicketList/TicketStatusBadge';
import type { TicketStatus } from '../../types/ticket';

interface NearbyTicketsProps {
  ticketId: string;
  gpsCoordinates: string | null | undefined;
  /** Also exclude these ticket IDs (e.g. related tickets already shown) */
  excludeIds?: string[];
  radius?: number;
}

function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toISOString().split('T')[0] ?? dateString;
  } catch {
    return dateString;
  }
}

export function NearbyTickets({
  ticketId,
  gpsCoordinates,
  excludeIds = [],
  radius = 100,
}: NearbyTicketsProps) {
  const { nearbyTickets, isLoading, isError, refetch } = useNearbyTickets(
    ticketId,
    gpsCoordinates,
    radius
  );

  if (!gpsCoordinates) return null;

  // Filter out tickets already shown in Related Tickets
  const filtered = nearbyTickets.filter(t => !excludeIds.includes(t.id));

  return (
    <div className="bg-[var(--ff-bg-card)] rounded-lg border border-[var(--ff-border-light)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <h3 className="font-semibold text-[var(--ff-text-primary)] text-base">
            Nearby Tickets
            {!isLoading && filtered.length > 0 && (
              <span className="ml-1.5 text-[var(--ff-text-tertiary)] font-normal">
                ({filtered.length})
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
          title="Refresh nearby tickets"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
        </button>
      </div>

      <p className="text-xs text-[var(--ff-text-tertiary)] mb-3">
        Within {radius}m of this location
      </p>

      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <InlineSpinner size="sm" />
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-center gap-2 py-3 px-3 bg-red-500/10 border border-red-500/20 rounded-md">
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-xs text-red-400">Failed to load nearby tickets</span>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="py-4 text-center">
          <p className="text-sm text-[var(--ff-text-tertiary)]">
            No other tickets nearby
          </p>
        </div>
      )}

      {!isLoading && !isError && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/noc/tickets/${ticket.id}`}
              className={cn(
                'block p-3 rounded-lg transition-colors',
                'bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)]',
                'border border-transparent hover:border-[var(--ff-border-light)]'
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-blue-400">
                      {ticket.ticket_uid}
                    </span>
                    <span className="text-xs text-orange-400 font-medium">
                      {ticket.distance_meters}m
                    </span>
                  </div>
                  <p className="text-sm text-[var(--ff-text-primary)] truncate mt-0.5">
                    {ticket.title}
                  </p>
                  {ticket.dr_number && (
                    <span className="text-xs text-[var(--ff-text-tertiary)] font-mono">
                      {ticket.dr_number}
                    </span>
                  )}
                </div>
              </div>

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
