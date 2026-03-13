'use client';

/**
 * KanbanBoard Component
 *
 * Main Kanban board for ticket workflow management.
 * Uses @hello-pangea/dnd for drag-and-drop.
 * Quick-move buttons let users advance/revert tickets without dragging.
 * Optimistic updates for instant visual feedback.
 */

import { useMemo, useState, useCallback } from 'react';
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd';
import type { Ticket, TicketFilters } from '../../types/ticket';
import { useTickets } from '../../hooks/useTickets';
import { useUpdateTicket } from '../../hooks/useTicket';
import { KanbanColumn } from './KanbanColumn';

interface KanbanBoardProps {
  filters?: TicketFilters;
}

// Database status values — aligned with TicketStatus enum
export type DatabaseStatus = 'new' | 'open' | 'assigned' | 'in_progress' | 'pending_qa' | 'qa_in_progress' | 'qa_rejected' | 'qa_approved' | 'pending_handover' | 'handed_to_ops' | 'resolved' | 'closed' | 'cancelled';

// Define visible columns and their order
interface ColumnConfig {
  status: DatabaseStatus;
}

const COLUMN_CONFIG: ColumnConfig[] = [
  { status: 'open' },
  { status: 'assigned' },
  { status: 'in_progress' },
  { status: 'pending_qa' },
  { status: 'resolved' },
  { status: 'closed' },
];

// Ordered status flow for quick-move navigation
const STATUS_FLOW: DatabaseStatus[] = COLUMN_CONFIG.map(c => c.status);

// Map legacy/unmapped statuses to a visible column
const STATUS_COLUMN_MAP: Record<string, DatabaseStatus> = {
  new: 'open',
  qa_in_progress: 'pending_qa',
  qa_rejected: 'in_progress',
  qa_approved: 'resolved',
  pending_handover: 'resolved',
  handed_to_ops: 'resolved',
};

// Active vs Completed column groups for sub-tab filtering
const ACTIVE_STATUSES: DatabaseStatus[] = ['open', 'assigned', 'in_progress', 'pending_qa'];
const COMPLETED_STATUSES: DatabaseStatus[] = ['resolved', 'closed'];

export function KanbanBoard({ filters }: KanbanBoardProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Optimistic status overrides: ticketId → new status (applied instantly, cleared on API response)
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, DatabaseStatus>>({});

  // Strip meta status filter (active/completed) — Kanban needs all statuses for columns
  const { status: metaStatus, ...apiFilters } = filters || {};

  // Fetch all tickets (no status filter for Kanban view)
  const { tickets, isLoading, isError, error, refetch } = useTickets({
    ...apiFilters,
    pageSize: 2000,
  });

  // Determine which columns to show based on sub-tab filter
  const visibleColumns = useMemo(() => {
    if ((metaStatus as string) === 'completed') return COLUMN_CONFIG.filter(c => COMPLETED_STATUSES.includes(c.status));
    if ((metaStatus as string) === 'active') return COLUMN_CONFIG.filter(c => ACTIVE_STATUSES.includes(c.status));
    return COLUMN_CONFIG;
  }, [metaStatus]);

  const updateTicket = useUpdateTicket();

  // Group tickets by status (with optimistic overrides applied)
  const ticketsByStatus = useMemo(() => {
    const grouped: Record<DatabaseStatus, Ticket[]> = {} as Record<DatabaseStatus, Ticket[]>;

    COLUMN_CONFIG.forEach(({ status }) => {
      grouped[status] = [];
    });

    tickets.forEach((ticket) => {
      // Apply optimistic move if present
      const optimisticStatus = optimisticMoves[ticket.id];
      const rawStatus = optimisticStatus || (ticket.status as string);
      const mappedStatus = (STATUS_COLUMN_MAP[rawStatus] || rawStatus) as DatabaseStatus;
      if (grouped[mappedStatus]) {
        grouped[mappedStatus].push(ticket);
      }
    });

    // Sort by priority then created date
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
  }, [tickets, optimisticMoves]);

  // Move a ticket to a new status (shared by drag-and-drop and quick-move)
  const moveTicket = useCallback(async (ticketId: string, newStatus: DatabaseStatus) => {
    setErrorMessage(null);

    // Optimistic: move card instantly
    setOptimisticMoves(prev => ({ ...prev, [ticketId]: newStatus }));

    try {
      await updateTicket.mutateAsync({
        id: ticketId,
        payload: { status: newStatus as any },
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to update ticket status');
      refetch();
    } finally {
      // Clear optimistic override — real data takes over from refetch/cache
      setOptimisticMoves(prev => {
        const next = { ...prev };
        delete next[ticketId];
        return next;
      });
    }
  }, [updateTicket, refetch]);

  // Handle drag end
  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    await moveTicket(draggableId, destination.droppableId as DatabaseStatus);
  }, [moveTicket]);

  // Handle quick-move (chevron buttons)
  const handleQuickMove = useCallback(async (ticketId: string, direction: 'forward' | 'backward') => {
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    const currentStatus = (optimisticMoves[ticketId] || STATUS_COLUMN_MAP[ticket.status as string] || ticket.status) as DatabaseStatus;
    const currentIndex = STATUS_FLOW.indexOf(currentStatus);
    if (currentIndex === -1) return;

    const newIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex < 0 || newIndex >= STATUS_FLOW.length) return;

    const nextStatus = STATUS_FLOW[newIndex];
    if (!nextStatus) return;
    await moveTicket(ticketId, nextStatus);
  }, [tickets, optimisticMoves, moveTicket]);

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
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-red-400">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-300"
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
          <span className="font-medium text-[var(--ff-text-primary)]">
            {metaStatus
              ? tickets.filter(t => visibleColumns.some(c => c.status === t.status)).length
              : tickets.length}
          </span> tickets total
        </span>
        <span className="text-[var(--ff-text-muted)]">|</span>
        <span className="text-[var(--ff-text-secondary)]">
          Drag or use <span className="inline-flex items-center gap-0.5 text-blue-400"><svg className="w-3 h-3 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg></span> to move tickets
        </span>
        {updateTicket.isPending && (
          <span className="flex items-center gap-2 text-blue-400">
            <div className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></div>
            Updating...
          </span>
        )}
      </div>

      {/* Kanban Columns */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto pb-4">
          <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[500px]">
            {visibleColumns.map(({ status }, colIndex) => (
              <Droppable key={status} droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="h-full"
                  >
                    <KanbanColumn
                      status={status}
                      tickets={ticketsByStatus[status]}
                      isDraggingOver={snapshot.isDraggingOver}
                      isUpdating={updateTicket.isPending}
                      onQuickMove={handleQuickMove}
                      canMoveForward={colIndex < visibleColumns.length - 1}
                      canMoveBackward={colIndex > 0}
                    />
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}
