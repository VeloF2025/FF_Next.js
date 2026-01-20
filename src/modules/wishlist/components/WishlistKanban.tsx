/**
 * Wishlist Kanban Board Component
 */

import { Droppable } from '@hello-pangea/dnd';
import { WishlistColumn } from './WishlistColumn';
import type { WishlistBoard, WishlistItem } from '../types/wishlist';

interface WishlistKanbanProps {
  board: WishlistBoard;
  onVote: (itemId: string) => Promise<any>;
  onDelete: (itemId: string) => Promise<void>;
  onEdit?: (item: WishlistItem) => void;
  onAttachments?: (item: WishlistItem) => void;
  canDrag?: boolean;
}

export function WishlistKanban({ board, onVote, onDelete, onEdit, onAttachments, canDrag = true }: WishlistKanbanProps) {
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
              <WishlistColumn
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