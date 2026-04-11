'use client';

/**
 * KanbanCard Component
 *
 * Lightweight ticket card for Kanban board.
 * Uses CSS transitions instead of framer-motion for drag performance.
 * Quick-advance buttons let users move tickets without dragging.
 */

import { useRouter } from 'next/navigation';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import type { Ticket } from '../../types/ticket';
import { TicketPriority } from '../../types/ticket';
import type { DatabaseStatus } from './KanbanBoard';
import { getT1Label, getT2Label } from '../../constants/ticketCategories';

interface KanbanCardProps {
  ticket: Ticket;
  isDragging?: boolean;
  onQuickMove?: (ticketId: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
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

// Format relative time
function formatRelativeTime(date: Date | string) {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return formatDisplayDateShort(date);
}

export function KanbanCard({ ticket, isDragging, onQuickMove, canMoveForward, canMoveBackward }: KanbanCardProps) {
  const router = useRouter();
  const priorityStyle = priorityColors[ticket.priority] || priorityColors[TicketPriority.NORMAL];
  const categoryStyle = categoryColors[(ticket as any).category?.toLowerCase()] ?? categoryColors['default'] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate when clicking quick-move buttons
    if ((e.target as HTMLElement).closest('[data-quick-move]')) return;
    router.push(`/noc/tickets/${ticket.id}`);
  };

  const getTimeInStatus = () => {
    const statusChangedAt = (ticket as any).status_changed_at || ticket.updated_at || ticket.created_at;
    return formatRelativeTime(new Date(statusChangedAt));
  };

  return (
    <div
      onClick={handleClick}
      className={`
        group relative p-3 bg-[var(--ff-bg-secondary)] rounded-lg border
        cursor-grab active:cursor-grabbing select-none
        transition-all duration-150 ease-out
        ${isDragging
          ? 'border-blue-400 ring-2 ring-blue-500/30 shadow-2xl scale-105 rotate-1 z-50 opacity-90'
          : 'border-[var(--ff-border-light)] hover:border-blue-400/50 hover:shadow-md hover:-translate-y-0.5'
        }
      `}
    >
      {/* Quick Move Buttons — visible on hover */}
      {onQuickMove && (
        <div
          data-quick-move
          className={`
            absolute -right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1
            opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10
            ${isDragging ? 'hidden' : ''}
          `}
        >
          {canMoveForward && (
            <button
              data-quick-move
              onClick={(e) => { e.stopPropagation(); onQuickMove(ticket.id, 'forward'); }}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-500 transition-colors"
              title="Move to next status"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {canMoveBackward && (
            <button
              data-quick-move
              onClick={(e) => { e.stopPropagation(); onQuickMove(ticket.id, 'backward'); }}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-600 text-white shadow-lg hover:bg-gray-500 transition-colors"
              title="Move to previous status"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Header: UID, T1 category, discipline, Priority */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-[var(--ff-text-muted)]">
            {ticket.ticket_uid}
          </span>
          {/* T1 label from discipline fallback */}
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${categoryStyle.bg} ${categoryStyle.text}`}>
            {getT1Label(ticket.ticket_type)}
          </span>
          {/* T1 ticket_category badge (new April-11 axis) */}
          {ticket.ticket_category && (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-indigo-500/15 text-indigo-300">
              {getT2Label(ticket.ticket_category)}
            </span>
          )}
        </div>
        <span
          className={`
            px-2 py-0.5 text-[10px] font-semibold rounded-full
            ${priorityStyle.bg} ${priorityStyle.text} border ${priorityStyle.border}
          `}
        >
          {ticket.priority.toUpperCase()}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-sm font-medium text-[var(--ff-text-primary)] mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
        {ticket.title}
      </h4>

      {/* DR Number and Asset */}
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
          ) : ticket.assigned_team_id ? (
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <span className="text-xs text-[var(--ff-text-secondary)] truncate max-w-[70px]">
                {(ticket as any).assigned_team_name || ticket.assigned_team || 'Team'}
              </span>
            </div>
          ) : (
            <span className="text-xs text-[var(--ff-text-muted)] italic">Unassigned</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--ff-text-muted)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded" title="Time in current status">
            {getTimeInStatus()}
          </span>
          <span className="text-[10px] text-[var(--ff-text-muted)]" title="Created">
            {formatRelativeTime(ticket.created_at)}
          </span>
        </div>
      </div>

      {/* Status Indicators Row */}
      {(ticket.qa_ready || ticket.sla_breached) && (
        <div className="flex items-center gap-2 mt-2">
          {ticket.qa_ready && (
            <div className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
              QA Ready
            </div>
          )}
          {ticket.sla_breached && (
            <div className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div>
              SLA Breached
            </div>
          )}
        </div>
      )}
    </div>
  );
}
