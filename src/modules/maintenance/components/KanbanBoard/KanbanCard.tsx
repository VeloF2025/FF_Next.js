'use client';

/**
 * KanbanCard Component (Enhanced)
 *
 * Ticket card for the Kanban board.
 * Uses @hello-pangea/dnd Draggable with framer-motion animations.
 * Features: Enhanced info density, time in status, category badge.
 */

import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import type { Ticket } from '../../types/ticket';
import { TicketPriority } from '../../types/ticket';

interface KanbanCardProps {
  ticket: Ticket;
  isDragging?: boolean;
}

const priorityColors: Record<TicketPriority, { bg: string; text: string; border: string }> = {
  [TicketPriority.CRITICAL]: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/40' },
  [TicketPriority.URGENT]: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/40' },
  [TicketPriority.HIGH]: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/40' },
  [TicketPriority.NORMAL]: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40' },
  [TicketPriority.LOW]: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/40' },
};

const categoryColors: Record<string, { bg: string; text: string }> = {
  'installation': { bg: 'bg-green-500/20', text: 'text-green-400' },
  'maintenance': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  'repair': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  'upgrade': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  'inspection': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  'default': { bg: 'bg-gray-500/20', text: 'text-gray-400' },
};

export function KanbanCard({ ticket, isDragging }: KanbanCardProps) {
  const router = useRouter();
  const priorityStyle = priorityColors[ticket.priority] || priorityColors[TicketPriority.NORMAL];
  const categoryStyle = categoryColors[(ticket as any).category?.toLowerCase()] || categoryColors.default;

  const handleClick = () => {
    router.push(`/maintenance/tickets/${ticket.id}`);
  };

  // Format relative time
  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return formatDisplayDateShort(date);
  };

  // Calculate time in current status
  const getTimeInStatus = () => {
    const statusChangedAt = (ticket as any).status_changed_at || ticket.updated_at || ticket.created_at;
    return formatRelativeTime(new Date(statusChangedAt));
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: 1,
        y: 0,
        scale: isDragging ? 1.05 : 1,
        rotate: isDragging ? 2 : 0,
        boxShadow: isDragging
          ? '0 20px 40px rgba(0,0,0,0.3), 0 10px 20px rgba(0,0,0,0.2)'
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
        scale: 1.02,
        boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
        y: -2,
      }}
      whileTap={{ scale: 0.98 }}
      onClick={handleClick}
      className={`
        group p-3 bg-[var(--ff-bg-secondary)] rounded-lg border
        cursor-grab active:cursor-grabbing select-none
        ${isDragging
          ? 'border-blue-400 ring-2 ring-blue-500/30 z-50'
          : 'border-[var(--ff-border-light)] hover:border-blue-400/50'
        }
      `}
    >
      {/* Drag Handle Indicator */}
      <div className={`
        absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full
        transition-all duration-200
        ${isDragging ? 'bg-blue-400' : 'bg-[var(--ff-border-light)] group-hover:bg-[var(--ff-text-muted)]'}
      `} />

      {/* Header: UID, Category, Priority */}
      <div className="flex items-center justify-between mb-2 mt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[var(--ff-text-muted)]">
            {ticket.ticket_uid}
          </span>
          {(ticket as any).category && (
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${categoryStyle.bg} ${categoryStyle.text}`}>
              {(ticket as any).category}
            </span>
          )}
        </div>
        <motion.span
          className={`
            px-2 py-0.5 text-[10px] font-semibold rounded-full
            ${priorityStyle.bg} ${priorityStyle.text} border ${priorityStyle.border}
          `}
          whileHover={{ scale: 1.05 }}
        >
          {ticket.priority.toUpperCase()}
        </motion.span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
        {ticket.title}
      </h4>

      {/* DR Number and Asset if present */}
      <div className="flex flex-wrap gap-2 mb-2">
        {ticket.dr_number && (
          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            </svg>
            {ticket.dr_number}
          </div>
        )}
        {(ticket as any).asset_id && (
          <div className="flex items-center gap-1 text-xs text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-2 py-0.5 rounded">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Asset
          </div>
        )}
      </div>

      {/* Footer: Assignee, Time in Status, Created */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--ff-border-light)]">
        <div className="flex items-center gap-2">
          {ticket.assigned_to ? (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-[10px] text-white font-medium">
                  {(ticket as any).assigned_user?.name?.charAt(0) || 'U'}
                </span>
              </div>
              <span className="text-xs text-[var(--ff-text-secondary)] truncate max-w-[70px]">
                {(ticket as any).assigned_user?.name || 'Assigned'}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--ff-text-muted)] italic">Unassigned</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Time in status */}
          <span className="text-[10px] text-[var(--ff-text-muted)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded" title="Time in current status">
            ⏱ {getTimeInStatus()}
          </span>
          {/* Created time */}
          <span className="text-[10px] text-[var(--ff-text-muted)]" title="Created">
            {formatRelativeTime(ticket.created_at)}
          </span>
        </div>
      </div>

      {/* Status Indicators Row */}
      {(ticket.qa_ready || ticket.sla_breached) && (
        <div className="flex items-center gap-2 mt-2">
          {/* QA Ready indicator */}
          {ticket.qa_ready && (
            <div className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
              QA Ready
            </div>
          )}

          {/* SLA Breached warning */}
          {ticket.sla_breached && (
            <motion.div
              className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full"
              animate={{ opacity: [1, 0.6, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
              SLA Breached
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
}
