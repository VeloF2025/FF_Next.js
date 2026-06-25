'use client';

/**
 * KanbanColumn Component
 *
 * Lightweight stage column — CSS transitions only (no framer-motion).
 * Supports quick-move via chevron buttons on cards.
 */

import { Draggable } from '@hello-pangea/dnd';
import type { PlanningItemWithRelations, PlanningStage } from '../../types/planning';
import { KanbanCard } from './KanbanCard';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface KanbanColumnProps {
  stage: PlanningStage;
  label: string;
  items: PlanningItemWithRelations[];
  /** True total count (may exceed items.length when capped) */
  totalCount?: number;
  isDraggingOver?: boolean;
  isUpdating?: boolean;
  onQuickMove?: (id: string, direction: 'forward' | 'backward') => void;
  canMoveForward?: boolean;
  canMoveBackward?: boolean;
}

const stageConfig: Partial<Record<PlanningStage, { color: string; bgColor: string; borderColor: string; glowColor: string }>> = {
  intake:         { color: 'text-gray-400',   bgColor: 'bg-gray-500/20',   borderColor: 'border-gray-500/40',   glowColor: 'ring-gray-500/30' },
  hld:            { color: 'text-blue-400',   bgColor: 'bg-blue-500/20',   borderColor: 'border-blue-500/40',   glowColor: 'ring-blue-500/30' },
  lld:            { color: 'text-indigo-400', bgColor: 'bg-indigo-500/20', borderColor: 'border-indigo-500/40', glowColor: 'ring-indigo-500/30' },
  splice:         { color: 'text-amber-400',  bgColor: 'bg-amber-500/20',  borderColor: 'border-amber-500/40',  glowColor: 'ring-amber-500/30' },
  change_control: { color: 'text-orange-400', bgColor: 'bg-orange-500/20', borderColor: 'border-orange-500/40', glowColor: 'ring-orange-500/30' },
  as_built:       { color: 'text-green-400',  bgColor: 'bg-green-500/20',  borderColor: 'border-green-500/40',  glowColor: 'ring-green-500/30' },
  on_hold:        { color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', borderColor: 'border-yellow-500/30', glowColor: 'ring-yellow-500/20' },
  cancelled:      { color: 'text-red-400',    bgColor: 'bg-red-500/10',    borderColor: 'border-red-500/30',    glowColor: 'ring-red-500/20' },
};

const defaultConfig = { color: 'text-gray-400', bgColor: 'bg-gray-500/20', borderColor: 'border-gray-500/40', glowColor: 'ring-gray-500/30' };

export function KanbanColumn({ stage, label, items, totalCount, isDraggingOver, isUpdating, onQuickMove, canMoveForward, canMoveBackward }: KanbanColumnProps) {
  const config = stageConfig[stage] ?? defaultConfig;

  return (
    <div
      className={`
        flex flex-col w-full min-w-0 h-full
        bg-[var(--ff-bg-secondary)] rounded-xl border-2
        transition-all duration-200 ease-out
        ${isDraggingOver
          ? `${config.borderColor} ring-4 ${config.glowColor} shadow-lg`
          : 'border-[var(--ff-border-light)] shadow-sm'
        }
      `}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between gap-2 p-2 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`
              px-2 py-1 text-[11px] font-semibold rounded-lg truncate
              ${config.bgColor} ${config.color}
              transition-transform duration-150
              ${isDraggingOver ? 'scale-105' : ''}
            `}
            title={label}
          >
            {label}
          </span>
          <span
            className={`
              text-xs font-medium px-2.5 py-1 rounded-full
              bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-muted)]
              transition-transform duration-150
              ${isDraggingOver ? 'scale-110' : ''}
            `}
            title={totalCount && totalCount > items.length ? `Showing ${items.length} of ${totalCount}` : undefined}
          >
            {totalCount && totalCount > items.length
              ? `${items.length}/${totalCount}`
              : items.length}
          </span>
        </div>

        {isUpdating && <InlineSpinner size="sm" />}
      </div>

      {/* Cards Container */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
        {/* Empty state */}
        {items.length === 0 && (
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
              {isDraggingOver ? 'Drop here!' : 'No items'}
            </span>
          </div>
        )}

        {/* Draggable cards */}
        {items.map((item, index) => (
          <Draggable key={item.id} draggableId={item.id} index={index}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                className={snapshot.isDragging ? 'z-50' : ''}
              >
                <KanbanCard
                  item={item}
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
        {isDraggingOver && items.length > 0 && (
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
