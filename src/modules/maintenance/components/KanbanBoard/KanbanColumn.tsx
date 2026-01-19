'use client';

/**
 * KanbanColumn Component
 *
 * A status column in the Kanban board.
 * Acts as a drop zone for dragged ticket cards.
 * Enhanced with smooth animations and visual feedback.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Ticket } from '../../types/ticket';
import type { DatabaseStatus } from './KanbanBoard';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  status: DatabaseStatus;
  tickets: Ticket[];
  onDrop: (ticketId: string, newStatus: DatabaseStatus) => void;
  isUpdating?: boolean;
}

// Status display configuration (matching database values)
const statusConfig: Record<DatabaseStatus, { label: string; color: string; bgColor: string; borderColor: string; glowColor: string }> = {
  'new': { label: 'New', color: 'text-gray-700', bgColor: 'bg-gray-100', borderColor: 'border-gray-300', glowColor: 'ring-gray-200' },
  'triaged': { label: 'Triaged', color: 'text-cyan-700', bgColor: 'bg-cyan-100', borderColor: 'border-cyan-300', glowColor: 'ring-cyan-200' },
  'assigned': { label: 'Assigned', color: 'text-blue-700', bgColor: 'bg-blue-100', borderColor: 'border-blue-300', glowColor: 'ring-blue-200' },
  'in_progress': { label: 'In Progress', color: 'text-indigo-700', bgColor: 'bg-indigo-100', borderColor: 'border-indigo-300', glowColor: 'ring-indigo-200' },
  'blocked': { label: 'Blocked', color: 'text-red-700', bgColor: 'bg-red-100', borderColor: 'border-red-300', glowColor: 'ring-red-200' },
  'resolved': { label: 'Resolved', color: 'text-green-700', bgColor: 'bg-green-100', borderColor: 'border-green-300', glowColor: 'ring-green-200' },
  'closed': { label: 'Closed', color: 'text-slate-700', bgColor: 'bg-slate-100', borderColor: 'border-slate-300', glowColor: 'ring-slate-200' },
  'cancelled': { label: 'Cancelled', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200', glowColor: 'ring-red-100' },
  'pending_approval': { label: 'Pending Approval', color: 'text-amber-700', bgColor: 'bg-amber-100', borderColor: 'border-amber-300', glowColor: 'ring-amber-200' },
};

export function KanbanColumn({ status, tickets, onDrop, isUpdating }: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);

  const config = statusConfig[status];

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only set false if we're leaving the column entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    const ticketId = e.dataTransfer.getData('text/plain');
    if (ticketId) {
      onDrop(ticketId, status);
    }
  };

  const handleCardDragStart = (_e: React.DragEvent<HTMLDivElement>, ticketId: string) => {
    setDraggingTicketId(ticketId);
  };

  const handleCardDragEnd = () => {
    setDraggingTicketId(null);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`
        flex flex-col min-w-[280px] max-w-[320px] h-full
        bg-[var(--ff-surface)] rounded-xl border-2
        transition-all duration-300 ease-out
        ${isDragOver
          ? `${config.borderColor} ring-4 ${config.glowColor} shadow-lg scale-[1.01]`
          : 'border-[var(--ff-border)] shadow-sm'
        }
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--ff-border)]">
        <div className="flex items-center gap-2">
          <motion.span
            className={`
              px-3 py-1.5 text-xs font-semibold rounded-lg
              ${config.bgColor} ${config.color}
              shadow-sm
            `}
            animate={isDragOver ? { scale: 1.05 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            {config.label}
          </motion.span>
          <motion.span
            className="text-xs font-medium text-[var(--ff-text-muted)] bg-[var(--ff-bg)] px-2.5 py-1 rounded-full"
            animate={isDragOver ? { scale: 1.1, backgroundColor: '#dbeafe' } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            {tickets.length}
          </motion.span>
        </div>
        <AnimatePresence>
          {isUpdating && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="flex items-center gap-2"
            >
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
              <span className="text-xs text-blue-500">Updating...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <AnimatePresence mode="popLayout">
          {tickets.length === 0 ? (
            <motion.div
              key="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`
                flex flex-col items-center justify-center h-32 gap-2
                border-2 border-dashed rounded-xl
                transition-all duration-300
                ${isDragOver
                  ? `${config.borderColor} ${config.bgColor}`
                  : 'border-[var(--ff-border)] bg-[var(--ff-bg)]'
                }
              `}
            >
              <motion.div
                animate={isDragOver ? { scale: 1.2, y: -5 } : { scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                {isDragOver ? (
                  <svg className={`w-8 h-8 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-[var(--ff-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                )}
              </motion.div>
              <span className={`text-sm font-medium ${isDragOver ? config.color : 'text-[var(--ff-text-muted)]'}`}>
                {isDragOver ? 'Drop here!' : 'No tickets'}
              </span>
            </motion.div>
          ) : (
            tickets.map((ticket) => (
              <KanbanCard
                key={ticket.id}
                ticket={ticket}
                isDragging={draggingTicketId === ticket.id}
                onDragStart={handleCardDragStart}
                onDragEnd={handleCardDragEnd}
              />
            ))
          )}
        </AnimatePresence>

        {/* Drop Preview Indicator */}
        <AnimatePresence>
          {isDragOver && tickets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 60 }}
              exit={{ opacity: 0, height: 0 }}
              className={`
                flex items-center justify-center
                border-2 border-dashed rounded-lg
                ${config.borderColor} ${config.bgColor}
              `}
            >
              <svg className={`w-5 h-5 ${config.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
