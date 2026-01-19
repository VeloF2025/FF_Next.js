'use client';

/**
 * KanbanCard Component
 *
 * Draggable ticket card for the Kanban board.
 * Shows ticket summary with priority badge and key info.
 * Enhanced with smooth drag animations.
 */

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import type { Ticket } from '../../types/ticket';
import { TicketPriority } from '../../types/ticket';

interface KanbanCardProps {
  ticket: Ticket;
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, ticketId: string) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

const priorityColors: Record<TicketPriority, { bg: string; text: string; border: string; glow: string }> = {
  [TicketPriority.CRITICAL]: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', glow: 'shadow-red-200' },
  [TicketPriority.URGENT]: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', glow: 'shadow-orange-200' },
  [TicketPriority.HIGH]: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', glow: 'shadow-amber-200' },
  [TicketPriority.NORMAL]: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', glow: 'shadow-blue-200' },
  [TicketPriority.LOW]: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-300', glow: 'shadow-gray-200' },
};

export function KanbanCard({ ticket, isDragging, onDragStart, onDragEnd }: KanbanCardProps) {
  const router = useRouter();
  const [isLifted, setIsLifted] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const priorityStyle = priorityColors[ticket.priority] || priorityColors[TicketPriority.NORMAL];

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate if we just finished dragging
    if (isLifted) {
      e.preventDefault();
      return;
    }
    router.push(`/ticketing/tickets/${ticket.id}`);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    setIsLifted(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ticket.id);

    // Create a custom drag image
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      e.dataTransfer.setDragImage(cardRef.current, rect.width / 2, 20);
    }

    onDragStart?.(e, ticket.id);
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    setTimeout(() => setIsLifted(false), 100);
    onDragEnd?.(e);
  };

  // Format relative time
  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString();
  };

  return (
    <motion.div
      ref={cardRef}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: isDragging ? 0.4 : 1,
        y: 0,
        scale: isLifted ? 1.02 : 1,
        rotate: isLifted ? 2 : 0,
        boxShadow: isLifted
          ? '0 20px 40px rgba(0,0,0,0.15), 0 10px 20px rgba(0,0,0,0.1)'
          : '0 1px 3px rgba(0,0,0,0.1)',
      }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
        layout: { duration: 0.3 }
      }}
      whileHover={{
        scale: 1.01,
        boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
        y: -2,
      }}
      whileTap={{ scale: 0.98 }}
      draggable
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`
        group p-3 bg-[var(--ff-card-bg)] rounded-lg border
        cursor-grab active:cursor-grabbing select-none
        ${isLifted
          ? 'border-blue-400 ring-2 ring-blue-200 z-50'
          : 'border-[var(--ff-border)] hover:border-blue-300'
        }
        ${isDragging ? 'border-dashed border-2 border-blue-300 bg-blue-50/50' : ''}
      `}
      style={{ touchAction: 'none' }}
    >
      {/* Drag Handle Indicator */}
      <div className={`
        absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full
        transition-all duration-200
        ${isLifted ? 'bg-blue-400' : 'bg-gray-200 group-hover:bg-gray-300'}
      `} />

      {/* Header: UID and Priority */}
      <div className="flex items-center justify-between mb-2 mt-1">
        <span className="text-xs font-medium text-[var(--ff-text-secondary)]">
          {ticket.ticket_uid}
        </span>
        <motion.span
          className={`
            px-2 py-0.5 text-xs font-medium rounded-full
            ${priorityStyle.bg} ${priorityStyle.text} border ${priorityStyle.border}
          `}
          whileHover={{ scale: 1.05 }}
        >
          {ticket.priority.toUpperCase()}
        </motion.span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2 line-clamp-2 group-hover:text-blue-600 transition-colors">
        {ticket.title}
      </h4>

      {/* DR Number if present */}
      {ticket.dr_number && (
        <div className="flex items-center gap-1 mb-2">
          <svg className="w-3 h-3 text-[var(--ff-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-xs text-[var(--ff-text-secondary)]">{ticket.dr_number}</span>
        </div>
      )}

      {/* Footer: Assignee and Time */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--ff-border)]">
        <div className="flex items-center gap-1">
          {ticket.assigned_to ? (
            <>
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-[10px] text-white font-medium">
                  {(ticket as any).assigned_user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <span className="text-xs text-[var(--ff-text-secondary)] truncate max-w-[80px]">
                {(ticket as any).assigned_user?.name || 'Assigned'}
              </span>
            </>
          ) : (
            <span className="text-xs text-[var(--ff-text-muted)] italic">Unassigned</span>
          )}
        </div>
        <span className="text-xs text-[var(--ff-text-muted)]">
          {formatRelativeTime(ticket.created_at)}
        </span>
      </div>

      {/* QA Ready indicator */}
      {ticket.qa_ready && (
        <motion.div
          className="mt-2 flex items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <span className="text-xs text-green-600 font-medium">QA Ready</span>
        </motion.div>
      )}

      {/* SLA Breached warning */}
      {ticket.sla_breached && (
        <motion.div
          className="mt-2 flex items-center gap-1"
          animate={{ opacity: [1, 0.6, 1] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
          <span className="text-xs text-red-600 font-medium">SLA Breached</span>
        </motion.div>
      )}
    </motion.div>
  );
}
