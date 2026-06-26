'use client';

/**
 * KanbanCard Component
 *
 * Lightweight planning item card for the Kanban board.
 * Uses CSS transitions instead of framer-motion for drag performance.
 * Quick-advance buttons let users move items without dragging.
 * Clicking the card navigates to /planning/<id>.
 */

import { useRouter } from 'next/navigation';
import { formatDisplayDateShort } from '@/utils/dateFormat';
import type { PlanningItemWithRelations, PlanningPriority } from '../../types/planning';

interface KanbanCardProps {
  item: PlanningItemWithRelations;
  isDragging?: boolean;
  onQuickMove?: (id: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
}

const priorityColors: Record<PlanningPriority, { bg: string; text: string; border: string }> = {
  urgent: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/40' },
  high:   { bg: 'bg-amber-500/20',  text: 'text-amber-400',  border: 'border-amber-500/40' },
  normal: { bg: 'bg-blue-500/20',   text: 'text-blue-400',   border: 'border-blue-500/40' },
  low:    { bg: 'bg-gray-500/20',   text: 'text-gray-400',   border: 'border-gray-500/40' },
};

export function KanbanCard({ item, isDragging, onQuickMove, canMoveForward, canMoveBackward }: KanbanCardProps) {
  const router = useRouter();
  const priorityStyle = priorityColors[item.priority] ?? priorityColors.normal;

  const handleClick = (e: React.MouseEvent) => {
    // Don't navigate when clicking quick-move buttons
    if ((e.target as HTMLElement).closest('[data-quick-move]')) return;
    router.push(`/planning/${item.id}`);
  };

  return (
    <div
      onClick={handleClick}
      className={`
        group relative p-2 bg-[var(--ff-bg-secondary)] rounded-lg border min-w-0
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
            absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-1
            opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10
            ${isDragging ? 'hidden' : ''}
          `}
        >
          {canMoveForward && (
            <button
              data-quick-move
              onClick={(e) => { e.stopPropagation(); onQuickMove(item.id, 'forward'); }}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-500 transition-colors"
              title="Move to next stage"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
          {canMoveBackward && (
            <button
              data-quick-move
              onClick={(e) => { e.stopPropagation(); onQuickMove(item.id, 'backward'); }}
              className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-600 text-white shadow-lg hover:bg-gray-500 transition-colors"
              title="Move to previous stage"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Header: UID + Priority */}
      <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
        <span className="text-[10px] font-mono text-[var(--ff-text-muted)] truncate max-w-full" title={item.item_uid}>
          {item.item_uid}
        </span>
        <span
          className={`
            px-1.5 py-0.5 text-[10px] font-semibold rounded-full shrink-0
            ${priorityStyle.bg} ${priorityStyle.text} border ${priorityStyle.border}
          `}
        >
          {item.priority.toUpperCase()}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-xs font-medium text-[var(--ff-text-primary)] mb-1.5 line-clamp-2 break-words group-hover:text-blue-400 transition-colors">
        {item.title}
      </h4>

      {/* Project + Scope area */}
      <div className="flex flex-wrap gap-1.5 mb-1.5 min-w-0">
        {(item.project_name ?? item.project_code) && (
          <div className="flex items-center gap-1 min-w-0 text-[11px] text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="truncate">{item.project_name ?? item.project_code}</span>
          </div>
        )}
        {item.scope_area && (
          <div className="flex items-center gap-1 min-w-0 text-[11px] text-[var(--ff-text-secondary)] bg-[var(--ff-bg-tertiary)] px-1.5 py-0.5 rounded">
            <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            </svg>
            <span className="truncate">{item.scope_area}</span>
          </div>
        )}
      </div>

      {/* Footer: Assignee + Created date */}
      <div className="flex items-center justify-between gap-1.5 mt-1.5 pt-1.5 border-t border-[var(--ff-border-light)] min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {item.assigned_user ? (
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-5 h-5 shrink-0 rounded-full bg-blue-500 flex items-center justify-center">
                <span className="text-[10px] text-white font-medium">
                  {item.assigned_user.name?.charAt(0) ?? 'U'}
                </span>
              </div>
              <span className="text-[11px] text-[var(--ff-text-secondary)] truncate max-w-[56px]">
                {item.assigned_user.name}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-[var(--ff-text-muted)] italic truncate">Unassigned</span>
          )}
        </div>

        <span className="text-[10px] text-[var(--ff-text-muted)] shrink-0" title="Created">
          {formatDisplayDateShort(item.created_at)}
        </span>
      </div>
    </div>
  );
}
