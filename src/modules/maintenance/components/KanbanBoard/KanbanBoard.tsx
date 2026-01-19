'use client';

/**
 * KanbanBoard Component
 *
 * Main Kanban board for ticket workflow management.
 * Displays tickets grouped by status in draggable columns.
 */

import { useMemo, useState } from 'react';
import type { Ticket, TicketFilters } from '../../types/ticket';
import { useTickets } from '../../hooks/useTickets';
import { useUpdateTicket } from '../../hooks/useTicket';
import { KanbanColumn } from './KanbanColumn';

interface KanbanBoardProps {
  filters?: TicketFilters;
}

// Database status values (from tickets_status_check constraint)
export type DatabaseStatus = 'new' | 'triaged' | 'assigned' | 'in_progress' | 'blocked' | 'resolved' | 'closed' | 'cancelled' | 'pending_approval';

// Define visible columns and their order (matching actual database values)
const VISIBLE_STATUSES: DatabaseStatus[] = [
  'new',
  'triaged',
  'assigned',
  'in_progress',
  'blocked',
  'resolved',
  'closed',
];

export function KanbanBoard({ filters }: KanbanBoardProps) {
  const [updatingTicketId, setUpdatingTicketId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fetch all tickets (no status filter for Kanban view)
  const { tickets, isLoading, isError, error, refetch } = useTickets({
    ...filters,
    pageSize: 500, // Load more tickets for Kanban
  });

  const updateTicket = useUpdateTicket();

  // Group tickets by status
  const ticketsByStatus = useMemo(() => {
    const grouped: Record<DatabaseStatus, Ticket[]> = {} as Record<DatabaseStatus, Ticket[]>;

    // Initialize all statuses with empty arrays
    VISIBLE_STATUSES.forEach((status) => {
      grouped[status] = [];
    });

    // Sort tickets into their status buckets
    tickets.forEach((ticket) => {
      const status = ticket.status as unknown as DatabaseStatus;
      if (grouped[status]) {
        grouped[status].push(ticket);
      }
    });

    // Sort tickets within each column by priority (critical first) and then by created date
    const priorityOrder = ['critical', 'urgent', 'high', 'normal', 'low'];
    Object.keys(grouped).forEach((status) => {
      grouped[status as DatabaseStatus].sort((a, b) => {
        const priorityA = priorityOrder.indexOf(a.priority);
        const priorityB = priorityOrder.indexOf(b.priority);
        if (priorityA !== priorityB) return priorityA - priorityB;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });

    return grouped;
  }, [tickets]);

  // Handle ticket drop (status change)
  const handleDrop = async (ticketId: string, newStatus: DatabaseStatus) => {
    // Find the ticket to check current status
    const ticket = tickets.find((t) => t.id === ticketId);
    if (!ticket) return;

    // Don't update if status hasn't changed
    if ((ticket.status as unknown as DatabaseStatus) === newStatus) return;

    setUpdatingTicketId(ticketId);
    setErrorMessage(null);

    try {
      await updateTicket.mutateAsync({
        id: ticketId,
        payload: { status: newStatus as any }, // Cast to match API expectation
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update ticket status');
      // Refetch to reset the UI
      refetch();
    } finally {
      setUpdatingTicketId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full"></div>
          <span className="text-[var(--ff-text-secondary)]">Loading tickets...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-[var(--ff-text-primary)] font-medium">Failed to load tickets</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{error?.message}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Error Toast */}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-red-700">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-500 hover:text-red-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Stats Bar */}
      <div className="mb-4 flex items-center gap-4 text-sm">
        <span className="text-[var(--ff-text-secondary)]">
          <span className="font-medium text-[var(--ff-text-primary)]">{tickets.length}</span> tickets total
        </span>
        <span className="text-[var(--ff-text-muted)]">|</span>
        <span className="text-[var(--ff-text-secondary)]">
          Drag cards to change status
        </span>
      </div>

      {/* Kanban Columns */}
      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[500px]">
          {VISIBLE_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tickets={ticketsByStatus[status]}
              onDrop={handleDrop}
              isUpdating={updateTicket.isPending && ticketsByStatus[status].some(t => t.id === updatingTicketId)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
