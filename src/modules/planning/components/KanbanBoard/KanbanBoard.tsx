'use client';

// Kanban board for planning items — stage-based, drag-and-drop + quick-move, optimistic updates.

import { useMemo, useState, useCallback } from 'react';
import { DragDropContext, Droppable, type DropResult } from '@hello-pangea/dnd';
import type { BoardStage, PlanningFilters, PlanningItemWithRelations, PlanningStage } from '../../types/planning';
import { BOARD_STAGES, STAGE_FLOW, PARKED_STAGES } from '../../constants/stages';
import { usePlanningItems } from '../../hooks/usePlanningItems';
import { useUpdatePlanningItem } from '../../hooks/usePlanningItem';
import { KanbanColumn } from './KanbanColumn';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

interface KanbanBoardProps {
  filters?: PlanningFilters;
}

const KANBAN_PAGE_SIZE = 2500;
const DEFAULT_EXCLUDED_STAGES: PlanningStage[] = PARKED_STAGES;

export function KanbanBoard({ filters }: KanbanBoardProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, PlanningStage>>({});

  const result = usePlanningItems({ ...filters, exclude_stage: DEFAULT_EXCLUDED_STAGES, pageSize: KANBAN_PAGE_SIZE });
  const items: PlanningItemWithRelations[] = useMemo(() => result.data?.data ?? [], [result.data]);
  const { isLoading, isError, refetch } = result;
  const error = result.error as Error | null;
  const updateItem = useUpdatePlanningItem();

  const itemsByStage = useMemo(() => {
    const grouped: Record<string, PlanningItemWithRelations[]> = {};
    BOARD_STAGES.forEach(({ key }) => { grouped[key] = []; });
    items.forEach((item) => {
      const stage = optimisticMoves[item.id] ?? item.stage ?? 'intake';
      if (grouped[stage] !== undefined) grouped[stage].push(item);
    });
    const priorityOrder = ['urgent', 'high', 'normal', 'low'];
    (Object.keys(grouped) as string[]).forEach((stage) => {
      const col = grouped[stage];
      if (!col) return;
      col.sort((a, b) => {
        const pa = priorityOrder.indexOf(a.priority), pb = priorityOrder.indexOf(b.priority);
        if (pa !== pb) return pa - pb;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    });
    return grouped;
  }, [items, optimisticMoves]);

  const moveItem = useCallback(async (itemId: string, newStage: PlanningStage) => {
    setErrorMessage(null);
    setOptimisticMoves(prev => ({ ...prev, [itemId]: newStage }));
    try {
      await updateItem.mutateAsync({ id: itemId, payload: { stage: newStage } });
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to update item stage');
      refetch();
    } finally {
      setOptimisticMoves(prev => { const next = { ...prev }; delete next[itemId]; return next; });
    }
  }, [updateItem, refetch]);

  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    await moveItem(draggableId, destination.droppableId as PlanningStage);
  }, [moveItem]);

  const handleQuickMove = useCallback(async (itemId: string, direction: 'forward' | 'backward') => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const currentStage = (optimisticMoves[itemId] ?? item.stage ?? 'intake') as PlanningStage;
    const currentIndex = STAGE_FLOW.indexOf(currentStage as BoardStage);
    if (currentIndex === -1) return;
    const newIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1;
    if (newIndex < 0 || newIndex >= STAGE_FLOW.length) return;
    const nextStage = STAGE_FLOW[newIndex];
    if (!nextStage) return;
    await moveItem(itemId, nextStage);
  }, [items, optimisticMoves, moveItem]);

  if (isLoading) return <LoadingSpinner className="h-96" size="lg" label="Loading planning items..." />;

  if (isError) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-[var(--ff-text-primary)] font-medium">Failed to load planning items</p>
          <p className="text-sm text-[var(--ff-text-secondary)]">{error?.message}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-400">{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-red-300 ml-3">✕</button>
        </div>
      )}
      <div className="mb-4 flex items-center gap-4 text-sm">
        <span className="text-[var(--ff-text-secondary)]">
          Showing <span className="font-medium text-[var(--ff-text-primary)]">{items.length}</span> planning items
        </span>
        <span className="text-[var(--ff-text-muted)]">|</span>
        <span className="text-[var(--ff-text-secondary)]">Drag or use ›/‹ to move items</span>
        {updateItem.isPending && (
          <span className="flex items-center gap-2 text-blue-400">
            <InlineSpinner size="sm" />Updating...
          </span>
        )}
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex-1 overflow-x-auto pb-4">
          <div
            className="grid gap-3 h-[calc(100vh-280px)] min-h-[500px]"
            style={{ gridTemplateColumns: `repeat(${BOARD_STAGES.length}, minmax(180px, 300px))` }}
          >
            {BOARD_STAGES.map(({ key, label }, colIndex) => (
              <Droppable key={key} droppableId={key}>
                {(provided, snapshot) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} className="h-full min-w-0">
                    <KanbanColumn
                      stage={key}
                      label={label}
                      items={itemsByStage[key] ?? []}
                      isDraggingOver={snapshot.isDraggingOver}
                      isUpdating={updateItem.isPending}
                      onQuickMove={handleQuickMove}
                      canMoveForward={colIndex < BOARD_STAGES.length - 1}
                      canMoveBackward={colIndex > 0}
                    />
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </div>
      </DragDropContext>
    </div>
  );
}
