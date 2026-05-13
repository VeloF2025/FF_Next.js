import { Droppable, Draggable } from '@hello-pangea/dnd';
import { photoUrl } from '../utils/photo-url';

interface UnassignedBucketProps {
  photoKeys: string[];
  onView?: (index: number) => void;
  disabled?: boolean;
}

/**
 * Bottom-of-panel bucket for photos linked to the pole but not yet assigned to
 * a slot. Photos can be dragged in (delete from slot) or out (place into the
 * right slot). Each move goes through /api/works-qa/move-photo which records a
 * row in qa_correction_examples so the VLM model learns the categorisation.
 */
export function UnassignedBucket({ photoKeys, onView, disabled }: UnassignedBucketProps) {
  return (
    <section className="border border-dashed border-zinc-700 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          Unassigned Photos ({photoKeys.length})
        </h3>
        <span className="text-[10px] text-zinc-500">drag to slot →</span>
      </div>

      <Droppable droppableId="unassigned" direction="horizontal" isDropDisabled={disabled}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-20 rounded transition-colors ${
              snapshot.isDraggingOver ? 'bg-teal-500/10 ring-1 ring-teal-500/40' : ''
            }`}
          >
            {photoKeys.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                {snapshot.isDraggingOver
                  ? 'Drop here to send back for re-categorisation'
                  : 'No unassigned photos for this pole.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {photoKeys.map((key, i) => (
                  <Draggable key={key} draggableId={`unassigned:${key}`} index={i} isDragDisabled={disabled}>
                    {(dragProvided, dragSnap) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        className={`relative rounded overflow-hidden ${
                          dragSnap.isDragging ? 'ring-2 ring-teal-400 shadow-lg' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onView?.(i)}
                          disabled={!onView}
                          className="block w-full h-16 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          aria-label="Open unassigned photo"
                        >
                          <img
                            src={photoUrl(key)}
                            alt={`Unassigned ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      </div>
                    )}
                  </Draggable>
                ))}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  );
}
