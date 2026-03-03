/**
 * Phase 2: Photo Review
 * Walk through each checklist step, view assigned photos, toggle checked state.
 * Click any photo to open full-screen lightbox with zoom.
 * Drag-and-drop photos between steps to correct VLM misclassifications.
 *
 * DnD UX: During a drag, ALL steps expand so every drop zone is visible.
 * When not dragging, only one step is expanded (accordion mode).
 */

'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult, type DragStart } from '@hello-pangea/dnd';
import { CheckCircle, ChevronDown, ChevronRight, Image, AlertTriangle, Maximize2, GripVertical, X as XIcon } from 'lucide-react';
import type { ChecklistStep, Discipline } from '../../types';
import { PhotoLightbox } from './PhotoLightbox';

interface PhotoData {
  id: string;
  storage_key: string;
  source: string;
  filename: string | null;
  checklist_step: number | null;
  vlm_valid: boolean | null;
  vlm_confidence: number | null;
  vlm_issues: string[];
  vlm_feedback: string | null;
  manual_status: string | null;
  needs_retake: boolean;
}

interface Props {
  review: { discipline: Discipline; [key: string]: unknown };
  photos: PhotoData[];
  checklist: readonly ChecklistStep[];
  checkedSteps: Record<string, boolean>;
  onStepChange: (col: string, val: boolean) => void;
  onPhotoStepChange?: (photoId: string, newStep: number | null, stepLabel: string | null) => void;
}

export function PhasePhotoReview({ review, photos, checklist, checkedSteps, onStepChange, onPhotoStepChange }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Group photos by step (step 0 = VLM-classified "unrelated" — treat as unassigned)
  const photosByStep = new Map<number, PhotoData[]>();
  const unassigned: PhotoData[] = [];
  for (const photo of photos) {
    if (photo.checklist_step != null && photo.checklist_step > 0) {
      if (!photosByStep.has(photo.checklist_step)) photosByStep.set(photo.checklist_step, []);
      photosByStep.get(photo.checklist_step)!.push(photo);
    } else {
      unassigned.push(photo);
    }
  }

  // Flat list of all photos for lightbox navigation (step photos first, then unassigned)
  const allPhotos = useMemo(() => {
    const ordered: PhotoData[] = [];
    for (const step of checklist) {
      const stepPhotos = photosByStep.get(step.step) || [];
      ordered.push(...stepPhotos);
    }
    ordered.push(...unassigned);
    return ordered;
  }, [photos, checklist]);

  const openLightbox = (photoId: string) => {
    const idx = allPhotos.findIndex(p => p.id === photoId);
    if (idx >= 0) setLightboxIndex(idx);
  };

  const getStepColumn = (step: number): string => {
    const pad = String(step).padStart(2, '0');
    const stepNames: Record<string, Record<number, string>> = {
      civil: { 1: 'before_photo', 2: 'during_photo', 3: 'depth_photo', 4: 'end_plates', 5: 'compaction', 6: 'level_check', 7: 'after_photo' },
      optical: { 1: 'cable_route', 2: 'attachment', 3: 'slack_coil', 4: 'cable_label', 5: 'no_backfeed', 6: 'sag_ok' },
      splicing: { 1: 'dome_on_pole', 2: 'dome_label', 3: 'open_dome', 4: 'splice_protectors', 5: 'slack_management', 6: 'strength_members', 7: 'seals_dustcaps', 8: 'pole_id', 11: 'cable_entries', 12: 'strength_members', 13: 'tube_routing', 14: 'tray_entries', 15: 'coiling_protectors', 16: 'readable_labels' },
    };
    return `${review.discipline}_step_${pad}_${stepNames[review.discipline]?.[step] || 'unknown'}`;
  };

  // Build step number → label lookup for DnD
  const stepLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of checklist) map.set(s.step, s.label);
    return map;
  }, [checklist]);

  const handleDragStart = useCallback((_start: DragStart) => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback((result: DropResult) => {
    setIsDragging(false);

    if (!result.destination || !onPhotoStepChange) return;
    const { draggableId, source, destination } = result;
    if (source.droppableId === destination.droppableId) return;

    const newStep = destination.droppableId === 'unassigned'
      ? null
      : Number(destination.droppableId.replace('step-', ''));
    const newLabel = newStep != null ? (stepLabelMap.get(newStep) ?? null) : null;

    onPhotoStepChange(draggableId, newStep, newLabel);

    // Auto-expand the destination step so the moved photo is visible
    if (newStep != null) {
      setExpandedStep(newStep);
    }
  }, [onPhotoStepChange, stepLabelMap]);

  const dndEnabled = Boolean(onPhotoStepChange);

  return (
    <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white mb-1">Photo Review</h2>
          <p className="text-sm text-gray-400">
            Review each checklist step and verify photos meet quality standards.
            {dndEnabled ? ' Drag photos between steps to correct classifications.' : ' Click any photo to enlarge.'}
          </p>
        </div>

        {/* Checklist Steps */}
        <div className="space-y-2">
          {checklist.map(step => {
            const stepPhotos = photosByStep.get(step.step) || [];
            const col = getStepColumn(step.step);
            const isChecked = checkedSteps[col] || false;
            // During drag: all steps show content. Otherwise: accordion (one at a time).
            const isExpanded = isDragging || expandedStep === step.step;
            const withConfidence = stepPhotos.filter(p => typeof p.vlm_confidence === 'number' && !isNaN(p.vlm_confidence));
            const avgConfidence = withConfidence.length > 0
              ? withConfidence.reduce((sum, p) => sum + (p.vlm_confidence ?? 0), 0) / withConfidence.length
              : null;

            return (
              <Droppable key={step.step} droppableId={`step-${step.step}`} direction="horizontal" isDropDisabled={!dndEnabled}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`border rounded-lg overflow-hidden transition-colors ${
                      snapshot.isDraggingOver
                        ? 'border-blue-500 ring-2 ring-blue-500/30 bg-blue-500/5'
                        : isDragging
                          ? 'border-blue-500/20'
                          : isChecked ? 'border-green-500/30' : 'border-[var(--border-color)]'
                    }`}
                  >
                    {/* Step Header */}
                    <div
                      onClick={() => !isDragging && setExpandedStep(expandedStep === step.step ? null : step.step)}
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--hover-bg)] transition-colors ${
                        snapshot.isDraggingOver ? 'bg-blue-500/10' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={e => { e.stopPropagation(); onStepChange(col, !isChecked); }}
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          isChecked
                            ? 'bg-green-600 border-green-600'
                            : 'border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {isChecked && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                      </button>

                      {/* Step Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">
                            Step {step.step}: {step.label}
                          </span>
                          {!step.required && (
                            <span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">optional</span>
                          )}
                        </div>
                        {!isDragging && <p className="text-xs text-gray-500 mt-0.5">{step.vlmCheck}</p>}
                      </div>

                      {/* Photo count + VLM score */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-xs text-gray-400">
                          <Image className="w-3 h-3" />
                          {stepPhotos.length}
                        </div>
                        {avgConfidence !== null && (
                          <span className={`text-xs font-mono ${
                            avgConfidence >= 0.8 ? 'text-green-400' :
                            avgConfidence >= 0.6 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {Math.round(avgConfidence * 100)}%
                          </span>
                        )}
                        {!isDragging && (
                          expandedStep === step.step
                            ? <ChevronDown className="w-4 h-4 text-gray-500" />
                            : <ChevronRight className="w-4 h-4 text-gray-500" />
                        )}
                      </div>
                    </div>

                    {/* Expanded: Photo Grid / Drop Zone */}
                    {isExpanded && (
                      <div className={`px-4 pb-3 border-t transition-colors ${
                        snapshot.isDraggingOver ? 'border-blue-500' : 'border-[var(--border-color)]'
                      }`}>
                        {!isDragging && step.notes && (
                          <p className="text-xs text-gray-500 py-2 italic">{step.notes}</p>
                        )}

                        {stepPhotos.length === 0 ? (
                          <div className={`text-center py-4 text-sm rounded-lg border-2 border-dashed mt-2 transition-colors ${
                            snapshot.isDraggingOver
                              ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                              : isDragging
                                ? 'border-blue-500/30 text-gray-500'
                                : 'border-gray-700 text-gray-500'
                          }`}>
                            {snapshot.isDraggingOver ? 'Drop photo here' : isDragging ? 'Drop here' : 'No photos assigned to this step'}
                          </div>
                        ) : isDragging ? (
                          /* Compact photo strip during drag — smaller thumbnails, horizontal scroll */
                          <div className={`flex gap-2 pt-2 pb-1 overflow-x-auto rounded-lg transition-colors ${
                            snapshot.isDraggingOver ? 'bg-blue-500/5' : ''
                          }`}>
                            {stepPhotos.map((photo, index) => (
                              <Draggable key={photo.id} draggableId={photo.id} index={index} isDragDisabled={!dndEnabled}>
                                {(dragProv, dragSnap) => (
                                  <div
                                    ref={dragProv.innerRef}
                                    {...dragProv.draggableProps}
                                    {...dragProv.dragHandleProps}
                                    className={`flex-shrink-0 w-12 h-12 rounded border overflow-hidden ${
                                      dragSnap.isDragging
                                        ? 'ring-2 ring-blue-500 shadow-lg z-50'
                                        : 'border-[var(--border-color)]'
                                    }`}
                                  >
                                    <img
                                      src={`/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`}
                                      alt={photo.filename || 'Photo'}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      draggable={false}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                          </div>
                        ) : (
                          /* Full photo grid when not dragging */
                          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 pt-3">
                            {stepPhotos.map((photo, index) => (
                              <PhotoThumbnail
                                key={photo.id}
                                photo={photo}
                                index={index}
                                dndEnabled={dndEnabled}
                                onClickPhoto={openLightbox}
                                onUnassign={dndEnabled ? () => onPhotoStepChange?.(photo.id, null, null) : undefined}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>

        {/* Unassigned Photos — always shown as droppable */}
        <Droppable droppableId="unassigned" direction="horizontal" isDropDisabled={!dndEnabled}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`border rounded-lg p-4 transition-colors ${
                snapshot.isDraggingOver
                  ? 'border-blue-500 bg-blue-500/5'
                  : unassigned.length > 0
                    ? 'border-yellow-500/30'
                    : 'border-gray-700 border-dashed'
              }`}
            >
              <h3 className={`text-sm font-medium mb-2 ${
                unassigned.length > 0 ? 'text-yellow-400' : 'text-gray-500'
              }`}>
                Unassigned Photos ({unassigned.length})
              </h3>
              {unassigned.length > 0 ? (
                <>
                  {!isDragging && (
                    <p className="text-xs text-gray-500 mb-3">
                      These photos are not linked to any checklist step.
                      {dndEnabled ? ' Drag them to the correct step above.' : ' Click to enlarge.'}
                    </p>
                  )}
                  <div className={`grid ${isDragging ? 'grid-cols-8 md:grid-cols-10 gap-1' : 'grid-cols-4 md:grid-cols-6 gap-2'}`}>
                    {unassigned.map((photo, index) => (
                      isDragging ? (
                        <Draggable key={photo.id} draggableId={photo.id} index={index} isDragDisabled={!dndEnabled}>
                          {(dragProv, dragSnap) => (
                            <div
                              ref={dragProv.innerRef}
                              {...dragProv.draggableProps}
                              {...dragProv.dragHandleProps}
                              className={`w-full aspect-square rounded border overflow-hidden ${
                                dragSnap.isDragging
                                  ? 'ring-2 ring-blue-500 shadow-lg z-50'
                                  : 'border-[var(--border-color)]'
                              }`}
                            >
                              <img
                                src={`/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`}
                                alt={photo.filename || 'Photo'}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                draggable={false}
                              />
                            </div>
                          )}
                        </Draggable>
                      ) : (
                        <PhotoThumbnail
                          key={photo.id}
                          photo={photo}
                          index={index}
                          dndEnabled={dndEnabled}
                          onClickPhoto={openLightbox}
                          compact
                        />
                      )
                    ))}
                  </div>
                </>
              ) : (
                <p className={`text-xs text-center py-3 ${
                  snapshot.isDraggingOver ? 'text-blue-400' : 'text-gray-600'
                }`}>
                  {snapshot.isDraggingOver ? 'Drop here to unassign' : 'No unassigned photos'}
                </p>
              )}
              {provided.placeholder}
            </div>
          )}
        </Droppable>

        {/* Lightbox */}
        {lightboxIndex !== null && (
          <PhotoLightbox
            photos={allPhotos}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </div>
    </DragDropContext>
  );
}

/** Swipe-left threshold in pixels to trigger unassign */
const SWIPE_THRESHOLD = 50;

/** Reusable draggable photo thumbnail for both step grids and unassigned section.
 *  Supports swipe-left to unassign (moves photo to unassigned pool).
 *  Also shows an X button on hover/long-press for quick unassign. */
function PhotoThumbnail({ photo, index, dndEnabled, onClickPhoto, compact, onUnassign }: {
  photo: PhotoData;
  index: number;
  dndEnabled: boolean;
  onClickPhoto: (id: string) => void;
  compact?: boolean;
  onUnassign?: () => void;
}) {
  // Use refs for swipe tracking to avoid stale closure issues
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeXRef = useRef(0);
  const swipingRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onUnassign || !e.touches[0]) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipingRef.current = false;
    swipeXRef.current = 0;
    setSwiping(false);
    setSwipeX(0);
  }, [onUnassign]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || !onUnassign || !e.touches[0]) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Only swipe left, and only if horizontal movement dominates
    if (!swipingRef.current && Math.abs(dy) > Math.abs(dx)) {
      touchStartX.current = null;
      return;
    }
    if (dx < -10) {
      e.preventDefault(); // Prevent scrolling while swiping
      const clamped = Math.max(dx, -120);
      swipingRef.current = true;
      swipeXRef.current = clamped;
      setSwiping(true);
      setSwipeX(clamped);
    }
  }, [onUnassign]);

  const handleTouchEnd = useCallback(() => {
    // Read from ref (always current) instead of state (may be stale)
    if (swipeXRef.current <= -SWIPE_THRESHOLD && onUnassign) {
      setSwipeX(-200);
      setTimeout(() => {
        onUnassign();
        setSwipeX(0);
        setSwiping(false);
        swipeXRef.current = 0;
        swipingRef.current = false;
      }, 150);
    } else {
      setSwipeX(0);
      setSwiping(false);
      swipeXRef.current = 0;
      swipingRef.current = false;
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }, [onUnassign]);

  // Also support mouse drag for desktop swipe
  const mouseDownX = useRef<number | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onUnassign) return;
    mouseDownX.current = e.clientX;
  }, [onUnassign]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (mouseDownX.current === null || !onUnassign) return;
    const dx = e.clientX - mouseDownX.current;
    if (dx < -10) {
      const clamped = Math.max(dx, -120);
      swipingRef.current = true;
      swipeXRef.current = clamped;
      setSwiping(true);
      setSwipeX(clamped);
    }
  }, [onUnassign]);

  const handleMouseUp = useCallback(() => {
    if (mouseDownX.current === null) return;
    mouseDownX.current = null;
    if (swipeXRef.current <= -SWIPE_THRESHOLD && onUnassign) {
      setSwipeX(-200);
      setTimeout(() => {
        onUnassign();
        setSwipeX(0);
        setSwiping(false);
        swipeXRef.current = 0;
        swipingRef.current = false;
      }, 150);
    } else {
      setSwipeX(0);
      setSwiping(false);
      swipeXRef.current = 0;
      swipingRef.current = false;
    }
  }, [onUnassign]);

  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_THRESHOLD, 1);

  return (
    <Draggable draggableId={photo.id} index={index} isDragDisabled={!dndEnabled}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className="relative"
        >
          {/* Swipe background — always rendered when swiping, bright orange */}
          {swiping && (
            <div className={`absolute inset-0 rounded-lg flex items-center justify-end pr-3 transition-colors ${
              swipeProgress >= 1 ? 'bg-orange-500/40' : 'bg-orange-500/20'
            }`}>
              <XIcon className={`w-6 h-6 transition-all ${
                swipeProgress >= 1 ? 'text-orange-300 scale-110' : 'text-orange-400/50'
              }`} />
            </div>
          )}

          <div
            className={`relative rounded-lg overflow-hidden border cursor-pointer transition-all group ${
              snapshot.isDragging
                ? 'ring-2 ring-blue-500 shadow-lg shadow-blue-500/20 z-50'
                : swiping && swipeProgress >= 1
                  ? 'border-orange-500 ring-1 ring-orange-500/50'
                  : 'hover:border-blue-500 hover:ring-2 hover:ring-blue-500/30 border-[var(--border-color)]'
            }`}
            style={swiping ? { transform: `translateX(${swipeX}px)`, transition: swipeX <= -200 ? 'transform 0.15s ease-out' : 'none' } : undefined}
            onClick={() => { if (!snapshot.isDragging && !swiping) onClickPhoto(photo.id); }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Drag handle */}
            {dndEnabled ? (
              <div
                {...provided.dragHandleProps}
                className="absolute top-1 left-1 z-10 p-0.5 rounded bg-black/50 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
              >
                <GripVertical className="w-3 h-3" />
              </div>
            ) : (
              <span {...provided.dragHandleProps} />
            )}

            {/* Unassign X button — visible on hover for quick removal */}
            {onUnassign && !snapshot.isDragging && !swiping && (
              <button
                onClick={e => { e.stopPropagation(); onUnassign(); }}
                className="absolute top-1 right-1 z-10 p-0.5 rounded-full bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                title="Remove from step"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}

            {/* Photo thumbnail */}
            <div className="aspect-square bg-gray-900 flex items-center justify-center">
              <img
                src={`/api/construction-qa/photo-proxy?key=${encodeURIComponent(photo.storage_key)}&source=${photo.source}`}
                alt={photo.filename || 'Photo'}
                className="w-full h-full object-cover"
                loading="lazy"
                draggable={false}
              />
            </div>

            {/* Enlarge indicator on hover */}
            {!snapshot.isDragging && !swiping && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none">
                <Maximize2 className={`${compact ? 'w-5 h-5' : 'w-6 h-6'} text-white opacity-0 group-hover:opacity-100 transition-opacity`} />
              </div>
            )}

            {/* VLM badge */}
            {!compact && typeof photo.vlm_confidence === 'number' && !isNaN(photo.vlm_confidence) && (
              <div className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                photo.vlm_confidence >= 0.8 ? 'bg-green-600/90 text-white' :
                photo.vlm_confidence >= 0.6 ? 'bg-yellow-600/90 text-white' :
                'bg-red-600/90 text-white'
              }`}>
                {Math.round(photo.vlm_confidence * 100)}%
              </div>
            )}

            {/* Retake warning */}
            {!compact && photo.needs_retake && (
              <div className="absolute top-1 left-1">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
              </div>
            )}

            {/* Filename at bottom */}
            {!compact && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1">
                <div className="text-[10px] text-gray-300 truncate">{photo.filename}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
