/**
 * TicketList Component - Main ticket list view
 *
 * 🟢 WORKING: Production-ready ticket list component
 *
 * Features:
 * - Display tickets in a filterable, paginated list
 * - Search and filter tickets
 * - Sort tickets
 * - Pagination controls
 * - Loading and error states
 * - Empty state handling
 * - Responsive design
 */

'use client';

import React, { useState } from 'react';
import {
  FileText,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTickets } from '../../hooks/useTickets';
import { TicketFilters } from './TicketFilters';
import { TicketListItem } from './TicketListItem';
import type { TicketFilters as TicketFiltersType, Ticket } from '../../types/ticket';

interface TicketListProps {
  /** Initial filters */
  initialFilters?: TicketFiltersType;
  /** Compact mode */
  compact?: boolean;
  /** Custom item click handler */
  onTicketClick?: (ticket: Ticket) => void;
  /** Hide filters */
  hideFilters?: boolean;
}

/**
 * 🟢 WORKING: Main ticket list component
 */
export function TicketList({
  initialFilters = {},
  compact = false,
  onTicketClick,
  hideFilters = false,
}: TicketListProps) {
  const [filters, setFilters] = useState<TicketFiltersType>({
    page: 1,
    pageSize: 20,
    ...initialFilters,
  });

  const { tickets, pagination, isLoading, isError, error, refetch } = useTickets(filters);

  // 🟢 WORKING: Handle filter change
  const handleFiltersChange = (newFilters: TicketFiltersType) => {
    setFilters({
      ...newFilters,
      page: 1, // Reset to first page when filters change
      pageSize: filters.pageSize,
    });
  };

  // 🟢 WORKING: Handle page change
  const handlePageChange = (newPage: number) => {
    setFilters({ ...filters, page: newPage });
  };

  // 🟢 WORKING: Handle refresh
  const handleRefresh = () => {
    refetch();
  };

  // 🟢 WORKING: Loading state
  if (isLoading && tickets.length === 0) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--ff-text-secondary)] animate-spin mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">Loading tickets...</p>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Error state
  if (isError && tickets.length === 0) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">Error Loading Tickets</h3>
              <p className="text-sm text-red-300">
                {error?.message || 'Failed to fetch tickets'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[var(--ff-text-primary)]">Tickets</h2>
          {pagination && (
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              {pagination.total} total tickets
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Refresh tickets"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      {!hideFilters && (
        <TicketFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
          compact={compact}
        />
      )}

      {/* Empty State */}
      {tickets.length === 0 && !isLoading && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <FileText className="w-16 h-16 text-[var(--ff-text-tertiary)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No tickets found</h3>
            <p className="text-sm text-[var(--ff-text-secondary)] mb-4">
              {Object.keys(filters).some(k => k !== 'page' && k !== 'pageSize' && filters[k as keyof TicketFiltersType])
                ? 'Try adjusting your filters to see more results'
                : 'No tickets have been created yet'}
            </p>
            {Object.keys(filters).some(k => k !== 'page' && k !== 'pageSize' && filters[k as keyof TicketFiltersType]) && (
              <button
                type="button"
                onClick={() => handleFiltersChange({})}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tickets List */}
      {tickets.length > 0 && (
        <div className="space-y-3">
          <ul className="space-y-3" role="list">
            {tickets.map((ticket) => (
              <li key={ticket.id} role="listitem">
                <TicketListItem
                  ticket={ticket}
                  compact={compact}
                  onClick={onTicketClick}
                />
              </li>
            ))}
          </ul>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-[var(--ff-text-secondary)]">
                Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
                {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
                {pagination.total} tickets
              </p>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1 || isLoading}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </button>

                <span className="text-sm text-[var(--ff-text-secondary)] px-4">
                  Page {pagination.page} of {pagination.totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.totalPages || isLoading}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
