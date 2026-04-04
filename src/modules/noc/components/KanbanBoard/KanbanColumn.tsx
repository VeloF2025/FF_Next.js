'use client';

/**
 * KanbanColumn Component
 *
 * Lightweight status column — CSS transitions only (no framer-motion).
 * Supports quick-move via chevron buttons on cards.
 */

import { Draggable } from '@hello-pangea/dnd';
import type { Ticket } from '../../types/ticket';
import type { DatabaseStatus } from './KanbanBoard';
import { KanbanCard } from './KanbanCard';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface KanbanColumnProps {
  status: DatabaseStatus;
  tickets: Ticket[];
  /** True total from summary endpoint (may exceed tickets.length when capped) */
  totalCount?: number;
  isDraggingOver?: boolean;
  isUpdating?: boolean;
  onQuickMove?: (ticketId: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
}

const statusConfig: Partial<Record<DatabaseStatus, { label: string; color: string; bgColor: string; borderColor: string; glowColor: string }>> = {
  'open': { label: 'Open', color: 'text-gray-400', bgColor: 'bg-gray-500/20', borderColor: 'border-gray-500/40', glowColor: 'ring-gray-500/30' },
  'assigned': { label: 'Assigned', color: 'text-blue-400', bgColor: 'bg-blue-500/20', borderColor: 'border-blue-500/40', glowColor: 'ring-blue-500/30' },
  'in_progress': { label: 'In Progress', color: 'text-indigo-400', bgColor: 'bg-indigo-500/20', borderColor: 'border-indigo-500/40', glowColor: 'ring-indigo-500/30' },
  'pending_qa': { label: 'Pending QA', color: 'text-amber-400', bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500/40', glowColor: 'ring-amber-500/30' },
  'resolved': { label: 'Resolved', color: 'text-green-400', bgColor: 'bg-green-500/20', borderColor: 'border-green-500/40', glowColor: 'ring-green-500/30' },
  'closed': { label: 'Closed', color: 'text-slate-400', bgColor: 'bg-slate-500/20', borderColor: 'border-slate-500/40', glowColor: 'ring-slate-500/30' },
  'cancelled': { label: 'Cancelled', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', glowColor: 'ring-red-500/20' },
};

const defaultConfig = { label: 'Unknown', color: 'text-gray-400', bgColor: 'bg-gray-500/20', borderColor: 'border-gray-500/40', glowColor: 'ring-gray-500/30' };

export function KanbanColumn({ status, tickets, totalCount, isDraggingOver, isUpdating, onQuickMove, canMoveForward, canMoveBackward }: KanbanColumnProps) {
  const config = statusConfig[status] || defaultConfig;

  return (
    <div
      className={`
        flex flex-col min-w-[280px] max-w-[320px] h-full
        bg-[var(--ff-bg-secondary)] rounded-xl border-2
        transition-all duration-200 ease-out
        ${isDraggingOver
          ? `${config.borderColor} ring-4 ${config.glowColor} shadow-lg`
          : 'border-[var(--ff-border-light)] shadow-sm'
        }
      `}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          <span
            className={`
              px-3 py-1.5 text-xs font-semibold rounded-lg
              ${config.bgColor} ${config.color}
              transition-transform duration-150
              ${isDraggingOver ? 'scale-105' : ''}
            `}
          >
            {config.label}
          </span>
          <span
            className={`
              text-xs font-medium px-2.5 py-1 rounded-full
              bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-muted)]
              transition-transform duration-150
              ${isDraggingOver ? 'scale-110' : ''}
            `}
            title={totalCount && totalCount > tickets.length ? `Showing ${tickets.length} of ${totalCount}` : undefined}
          >
            {totalCount && totalCount > tickets.length
              ? `${tickets.length}/${totalCount}`
              : tickets.length}
          </span>
        </div>

        {isUpdating && <InlineSpinner size="sm" />}
      </div>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Empty state */}
        {tickets.length === 0 && (
          <div
            className={`
              flex flex-col items-center justify-center h-32 gap-2
              border-2 border-dashed rounded-xl
              transition-all duration-200
              ${isDraggingOver
                ? `${config.borderColor} ${config.bgColor}`
                : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]'
              }
            `}
          >
            {isDraggingOver ? (
              <svg className={`w-8 h-8 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-[var(--ff-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            )}
            <span className={`text-sm font-medium ${isDraggingOver ? config.color : 'text-[var(--ff-text-muted)]'}`}>
              {isDraggingOver ? 'Drop here!' : 'No tickets'}
            </span>
          </div>
        )}

        {/* Draggable cards */}
        {tickets.map((ticket, index) => (
          <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={snapshot.isDragging ? 'z-50' : ''}
              >
                <KanbanCard
                  ticket={ticket}
                  isDragging={snapshot.isDragging}
                  onQuickMove={onQuickMove}
                  canMoveForward={canMoveForward}
                  canMoveBackward={canMoveBackward}
                />
              </div>
            )}
          </Draggable>
        ))}

        {/* Drop preview */}
        {isDraggingOver && tickets.length > 0 && (
          <div
            className={`
              flex items-center justify-center h-[60px]
              border-2 border-dashed rounded-lg transition-all duration-200
              ${config.borderColor} ${config.bgColor}
            `}
          >
            <svg className={`w-5 h-5 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
