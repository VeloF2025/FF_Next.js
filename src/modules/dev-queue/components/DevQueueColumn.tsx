/**
 * DevQueue Column Component
 */

import { Draggable } from '@hello-pangea/dnd';
import { DevQueueCard } from './DevQueueCard';
import type { DevQueueColumn as Column, DevQueueItem } from '../types/devQueue';

interface DevQueueColumnProps {
  column: Column;
  onVote: (itemId: string) => Promise<any>;
  onDelete: (itemId: string) => Promise<void>;
  onEdit?: (item: DevQueueItem) => void;
  onAttachments?: (item: DevQueueItem) => void;
  canDrag?: boolean;
}

export function DevQueueColumn({ column, onVote, onDelete, onEdit, onAttachments, canDrag = true }: DevQueueColumnProps) {
  const isOverLimit = column.wip_limit && column.items.length >= column.wip_limit;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 min-w-[320px]">
      {/* Column Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3
            className="font-medium text-sm"
            style={{ color: column.color || 'var(--ff-text-primary)' }}
          >
            {column.name}
          </h3>
          <div className="flex items-center gap-2">
            <span className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs rounded-full px-2 py-1">
              {column.items.length}
            </span>
            {column.wip_limit && (
              <span
                className={`text-xs rounded-full px-2 py-1 ${
                  isOverLimit
                    ? 'bg-red-100 text-red-800'
                    : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]'
                }`}
              >
                WIP: {column.items.length}/{column.wip_limit}
              </span>
            )}
          </div>
        </div>
        {isOverLimit && (
          <p className="text-xs text-red-600">
            WIP limit reached! Consider moving items before adding more.
          </p>
        )}
      </div>

      {/* Column Items */}
      <div className="space-y-2 min-h-[100px]">
        {column.items.map((item, index) => (
          <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={!canDrag}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...(canDrag ? provided.dragHandleProps : {})}
                className={`transition-transform ${
                  snapshot.isDragging ? 'rotate-2 scale-105' : ''
                } ${!canDrag ? 'cursor-default' : 'cursor-grab'}`}
              >
                <DevQueueCard
                  item={item}
                  onVote={onVote}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onAttachments={onAttachments}
                  isDragging={snapshot.isDragging}
                />
              </div>
            )}
          </Draggable>
        ))}
      </div>

      {/* Empty State */}
      {column.items.length === 0 && (
        <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
          <p className="text-sm">No items</p>
          <p className="text-xs mt-1">Drag items here to move them</p>
        </div>
      )}
    </div>
  );
}