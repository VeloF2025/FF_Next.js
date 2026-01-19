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
}

export function WishlistKanban({ board, onVote, onDelete }: WishlistKanbanProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {board.columns.map((column) => (
        <Droppable key={column.id} droppableId={column.name}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`min-w-[320px] transition-colors ${
                snapshot.isDraggingOver ? 'bg-blue-50/50 rounded-lg' : ''
              }`}
            >
              <WishlistColumn
                column={column}
                onVote={onVote}
                onDelete={onDelete}
              />
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      ))}
    </div>
  );
}