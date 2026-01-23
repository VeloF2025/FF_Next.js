'use client';

/**
 * KanbanColumn Component (Enhanced)
 *
 * A status column in the Kanban board.
 * Uses Draggable from @hello-pangea/dnd with framer-motion animations.
 * Features: WIP limits, smooth animations, visual feedback.
 */

import { Draggable } from '@hello-pangea/dnd';
import { motion, AnimatePresence } from 'framer-motion';
import type { Ticket } from '../../types/ticket';
import type { DatabaseStatus } from './KanbanBoard';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  status: DatabaseStatus;
  tickets: Ticket[];
  wipLimit?: number;
  isDraggingOver?: boolean;
  isUpdating?: boolean;
}

// Status display configuration (matching database values)
const statusConfig: Record<DatabaseStatus, { label: string; color: string; bgColor: string; borderColor: string; glowColor: string }> = {
  'new': { label: 'New', color: 'text-gray-400', bgColor: 'bg-gray-500/20', borderColor: 'border-gray-500/40', glowColor: 'ring-gray-500/30' },
  'triaged': { label: 'Triaged', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', borderColor: 'border-cyan-500/40', glowColor: 'ring-cyan-500/30' },
  'assigned': { label: 'Assigned', color: 'text-blue-400', bgColor: 'bg-blue-500/20', borderColor: 'border-blue-500/40', glowColor: 'ring-blue-500/30' },
  'in_progress': { label: 'In Progress', color: 'text-indigo-400', bgColor: 'bg-indigo-500/20', borderColor: 'border-indigo-500/40', glowColor: 'ring-indigo-500/30' },
  'blocked': { label: 'Blocked', color: 'text-red-400', bgColor: 'bg-red-500/20', borderColor: 'border-red-500/40', glowColor: 'ring-red-500/30' },
  'resolved': { label: 'Resolved', color: 'text-green-400', bgColor: 'bg-green-500/20', borderColor: 'border-green-500/40', glowColor: 'ring-green-500/30' },
  'closed': { label: 'Closed', color: 'text-slate-400', bgColor: 'bg-slate-500/20', borderColor: 'border-slate-500/40', glowColor: 'ring-slate-500/30' },
  'cancelled': { label: 'Cancelled', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30', glowColor: 'ring-red-500/20' },
  'pending_approval': { label: 'Pending Approval', color: 'text-amber-400', bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500/40', glowColor: 'ring-amber-500/30' },
};

export function KanbanColumn({ status, tickets, wipLimit, isDraggingOver, isUpdating }: KanbanColumnProps) {
  const config = statusConfig[status];
  const isAtLimit = wipLimit !== undefined && tickets.length >= wipLimit;
  const isOverLimit = wipLimit !== undefined && tickets.length > wipLimit;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`
        flex flex-col min-w-[280px] max-w-[320px] h-full
        bg-[var(--ff-bg-secondary)] rounded-xl border-2
        transition-all duration-300 ease-out
        ${isDraggingOver
          ? `${config.borderColor} ring-4 ${config.glowColor} shadow-lg scale-[1.01]`
          : 'border-[var(--ff-border-light)] shadow-sm'
        }
      `}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          <motion.span
            className={`
              px-3 py-1.5 text-xs font-semibold rounded-lg
              ${config.bgColor} ${config.color}
            `}
            animate={isDraggingOver ? { scale: 1.05 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            {config.label}
          </motion.span>
          <motion.span
            className={`
              text-xs font-medium px-2.5 py-1 rounded-full
              ${isOverLimit
                ? 'bg-red-500/20 text-red-400'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-muted)]'
              }
            `}
            animate={isDraggingOver ? { scale: 1.1 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 400 }}
          >
            {tickets.length}
          </motion.span>
        </div>

        <div className="flex items-center gap-2">
          {/* WIP Limit Indicator */}
          {wipLimit !== undefined && (
            <span
              className={`
                text-xs px-2 py-1 rounded-full
                ${isAtLimit
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-muted)]'
                }
              `}
            >
              WIP: {tickets.length}/{wipLimit}
            </span>
          )}

          {/* Updating Indicator */}
          <AnimatePresence>
            {isUpdating && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex items-center gap-1"
              >
                <div className="animate-spin w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full"></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* WIP Warning */}
      <AnimatePresence>
        {isAtLimit && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="px-3 py-2 bg-yellow-500/10 border-b border-yellow-500/20"
          >
            <p className="text-xs text-yellow-400">
              WIP limit reached! Move items before adding more.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Empty state with AnimatePresence */}
        <AnimatePresence>
          {tickets.length === 0 && (
            <motion.div
              key="empty-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`
                flex flex-col items-center justify-center h-32 gap-2
                border-2 border-dashed rounded-xl
                transition-all duration-300
                ${isDraggingOver
                  ? `${config.borderColor} ${config.bgColor}`
                  : 'border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]'
                }
              `}
            >
              <motion.div
                animate={isDraggingOver ? { scale: 1.2, y: -5 } : { scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300 }}
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
              </motion.div>
              <span className={`text-sm font-medium ${isDraggingOver ? config.color : 'text-[var(--ff-text-muted)]'}`}>
                {isDraggingOver ? 'Drop here!' : 'No tickets'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Draggable cards - no AnimatePresence wrapper to avoid ref conflicts */}
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
                />
              </div>
            )}
          </Draggable>
        ))}

        {/* Drop Preview Indicator - static, no AnimatePresence needed */}
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
    </motion.div>
  );
}
