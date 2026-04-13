/**
 * DevQueue Kanban Board Component
 */

import { Droppable } from '@hello-pangea/dnd';
import { DevQueueColumn } from './DevQueueColumn';
import type { DevQueueBoard, DevQueueItem } from '../types/devQueue';

interface DevQueueKanbanProps {
  board: DevQueueBoard;
  onVote: (itemId: string) => Promise<unknown>;
  onDelete: (itemId: string) => Promise<void>;
  onEdit?: (item: DevQueueItem) => void;
  onAttachments?: (item: DevQueueItem) => void;
  canDrag?: boolean;
}

export function DevQueueKanban({ board, onVote, onDelete, onEdit, onAttachments, canDrag = true }: DevQueueKanbanProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {board.columns.map((column) => (
        <Droppable key={column.id} droppableId={column.name} isDropDisabled={!canDrag}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`min-w-[320px] transition-colors ${
                snapshot.isDraggingOver && canDrag ? 'bg-blue-50/50 rounded-lg' : ''
              }`}
            >
              <DevQueueColumn
                column={column}
                onVote={onVote}
                onDelete={onDelete}
                onEdit={onEdit}
                onAttachments={onAttachments}
                canDrag={canDrag}
              />
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      ))}
    </div>
  );
}