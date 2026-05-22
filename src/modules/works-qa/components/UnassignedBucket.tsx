import { Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Sparkles } from 'lucide-react';
import { photoUrl } from '../utils/photo-url';
import { useBulkUpload, BulkUploadButton, UploadChipList } from './BulkUnassignedUpload';
import { useAutoSort } from '../hooks/useAutoSort';
import {
  UnassignedSuggestionBadge,
  type UnassignedSuggestion,
} from './UnassignedSuggestionBadge';

interface UnassignedBucketProps {
  poleId: string;
  photoKeys: string[];
  suggestions?: Record<string, UnassignedSuggestion>;
  onView?: (index: number) => void;
  onUploaded: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Photos linked to the pole but not yet placed in a slot. Three ways in:
 *   1. Drag a photo OUT of a slot back to the bucket (dnd in PoleDetailPanel).
 *   2. Bulk upload — [+ Bulk upload] button or drag-drop image files.
 *   3. QField/SharePoint sync (server-side).
 *
 * AI auto-sort: [🧠 Auto-sort] runs the multi-class VLM classifier over
 * the bucket. ≥0.95 confidence + empty slot → auto-placed. Lower
 * confidence or filled slots → suggestion badge with [Accept].
 */
export function UnassignedBucket({
  poleId, photoKeys, suggestions, onView, onUploaded, disabled,
}: UnassignedBucketProps) {
  const { chips, running: uploading, handleFiles, handleDrop } = useBulkUpload({ poleId, onUploaded });
  const { running: sorting, summary, error: sortError, sort } = useAutoSort({ poleId, onSorted: onUploaded });

  const suggestionMap = suggestions ?? {};
  const suggestionEntries = Object.entries(suggestionMap);

  return (
    <section
      onDrop={disabled ? undefined : e => void handleDrop(e)}
      onDragOver={disabled ? undefined : e => e.preventDefault()}
      className="border border-dashed border-zinc-700 rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between flex-wrap gap-1">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          Unassigned Photos ({photoKeys.length})
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Auto-sort + Accept are cleanup actions — they move photos OUT of the
              unassigned bucket. Allowed even on approved poles because photos
              sitting unassigned represent work that isn't actually done yet. */}
          {photoKeys.length > 0 && (
            <button
              type="button"
              onClick={() => void sort()}
              disabled={sorting || uploading}
              title="Run VLM classifier on every unassigned photo"
              className="text-[10px] px-2 py-0.5 rounded bg-teal-700/60 hover:bg-teal-600/80 disabled:bg-zinc-700/60 text-teal-100 disabled:text-zinc-400 transition-colors flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" aria-hidden="true" />
              {sorting ? `Sorting ${photoKeys.length}…` : 'Auto-sort with AI'}
            </button>
          )}
          {!disabled && <BulkUploadButton running={uploading} onFilesPicked={handleFiles} />}
          <span className="text-[10px] text-zinc-500">drag to slot →</span>
        </div>
      </div>

      {summary && (
        <p className="text-[10px] text-teal-300">
          Auto-placed {summary.auto_placed} · Suggested {summary.suggested} · Leftover {summary.leftover}
        </p>
      )}
      {sortError && (
        <p className="text-[10px] text-red-400">Auto-sort failed: {sortError}</p>
      )}

      <UploadChipList chips={chips} />

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
                  : 'No unassigned photos for this pole. Use [+ Bulk upload] or drop image files here.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {photoKeys.map((key, i) => {
                  const suggestion = suggestionMap[key];
                  return (
                    <Draggable key={key} draggableId={`unassigned:${key}`} index={i} isDragDisabled={disabled}>
                      {(dragProvided, dragSnap) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`relative rounded overflow-hidden group ${
                            dragSnap.isDragging ? 'ring-2 ring-teal-400 shadow-lg shadow-teal-500/30 z-50' : ''
                          }`}
                        >
                          {!disabled && (
                            <div
                              {...dragProvided.dragHandleProps}
                              aria-label="Drag to slot"
                              className="absolute top-1 left-1 z-10 p-0.5 rounded bg-black/60 text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="w-3 h-3" aria-hidden="true" />
                            </div>
                          )}

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
                              draggable={false}
                            />
                          </button>

                          {suggestion && (
                            <UnassignedSuggestionBadge
                              poleId={poleId}
                              photoKey={key}
                              suggestion={suggestion}
                              onAccepted={onUploaded}
                            />
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                })}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>

      {suggestionEntries.length > 0 && (
        <p className="text-[10px] text-zinc-500">
          {suggestionEntries.length} suggestion{suggestionEntries.length === 1 ? '' : 's'} pending — Accept each to file.
        </p>
      )}
    </section>
  );
}
