/**
 * Pipeline Kanban Board (PRD-058)
 * Drag-and-drop board for managing project pipeline stages
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import {
  AlertTriangle,
  Building2,
  DollarSign,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { PipelineProjectSummary, PipelineStatus } from '../types';

interface KanbanColumn {
  id: PipelineStatus;
  title: string;
  color: string;
  projects: PipelineProjectSummary[];
}

interface PipelineKanbanProps {
  projects: PipelineProjectSummary[];
  onStatusChange?: (projectId: string, newStatus: PipelineStatus) => Promise<void>;
  loading?: boolean;
}

// Define the Kanban columns in order
const COLUMN_CONFIG: Array<{ id: PipelineStatus; title: string; color: string }> = [
  { id: 'new', title: 'New', color: 'border-blue-500' },
  { id: 'qualification', title: 'Qualification', color: 'border-purple-500' },
  { id: 'approvals_in_progress', title: 'Approvals', color: 'border-yellow-500' },
  { id: 'approvals_complete', title: 'Approved', color: 'border-green-500' },
  { id: 'po_pending', title: 'PO Pending', color: 'border-orange-500' },
  { id: 'ready_to_plan', title: 'Ready to Plan', color: 'border-emerald-500' },
];

// Closed statuses shown in collapsed group
const CLOSED_STATUSES: PipelineStatus[] = ['planned', 'on_hold', 'cancelled', 'lost'];

export function PipelineKanban({ projects, onStatusChange, loading }: PipelineKanbanProps) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [_isDragging, setIsDragging] = useState(false);

  // Organize projects into columns
  useEffect(() => {
    const columnMap = new Map<PipelineStatus, PipelineProjectSummary[]>();

    // Initialize columns
    COLUMN_CONFIG.forEach(col => columnMap.set(col.id, []));

    // Distribute projects
    projects.forEach(project => {
      if (columnMap.has(project.pipeline_status)) {
        columnMap.get(project.pipeline_status)!.push(project);
      }
    });

    // Create column array
    const cols: KanbanColumn[] = COLUMN_CONFIG.map(config => ({
      ...config,
      projects: columnMap.get(config.id) || [],
    }));

    setColumns(cols);
  }, [projects]);

  const handleDragStart = () => {
    setIsDragging(true);
  };

  const handleDragEnd = async (result: DropResult) => {
    setIsDragging(false);

    if (!result.destination) return;

    const sourceCol = result.source.droppableId as PipelineStatus;
    const destCol = result.destination.droppableId as PipelineStatus;
    const projectId = result.draggableId;

    if (sourceCol === destCol) return;

    // Optimistically update UI
    setColumns(prev => {
      const newColumns = [...prev];
      const sourceIndex = newColumns.findIndex(c => c.id === sourceCol);
      const destIndex = newColumns.findIndex(c => c.id === destCol);

      if (sourceIndex === -1 || destIndex === -1) return prev;

      const sourceColumn = newColumns[sourceIndex];
      const destColumn = newColumns[destIndex];
      if (!sourceColumn || !destColumn) return prev;

      const projectIndex = sourceColumn.projects.findIndex(p => p.id === projectId);
      if (projectIndex === -1) return prev;

      const [movedProject] = sourceColumn.projects.splice(projectIndex, 1);
      if (!movedProject) return prev;

      movedProject.pipeline_status = destCol;
      destColumn.projects.splice(result.destination!.index, 0, movedProject);

      return newColumns;
    });

    // Call API to persist change
    if (onStatusChange) {
      try {
        await onStatusChange(projectId, destCol);
      } catch {
        // Revert on error - refresh data
      }
    }
  };

  const formatCurrency = (value: number | null | undefined) => {
    if (!value) return '—';
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const closedProjects = projects.filter(p => CLOSED_STATUSES.includes(p.pipeline_status));

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMN_CONFIG.map(col => (
          <div
            key={col.id}
            className="flex-shrink-0 w-72 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]"
          >
            <div className="p-3 border-b border-[var(--ff-border-light)]">
              <div className="h-5 w-24 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
            </div>
            <div className="p-3 space-y-3">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-24 bg-[var(--ff-bg-tertiary)] rounded animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(column => (
            <div
              key={column.id}
              className={`flex-shrink-0 w-72 bg-[var(--ff-bg-secondary)] rounded-lg border-t-4 ${column.color} border border-[var(--ff-border-light)]`}
            >
              {/* Column Header */}
              <div className="p-3 border-b border-[var(--ff-border-light)]">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-[var(--ff-text-primary)]">{column.title}</h3>
                  <span className="px-2 py-0.5 text-xs font-medium bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] rounded-full">
                    {column.projects.length}
                  </span>
                </div>
              </div>

              {/* Droppable Area */}
              <Droppable droppableId={column.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`p-2 min-h-[200px] transition-colors ${
                      snapshot.isDraggingOver ? 'bg-[var(--ff-bg-tertiary)]' : ''
                    }`}
                  >
                    {column.projects.length === 0 ? (
                      <div className="flex items-center justify-center h-24 text-sm text-[var(--ff-text-secondary)] border-2 border-dashed border-[var(--ff-border-light)] rounded-lg">
                        Drop projects here
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {column.projects.map((project, index) => (
                          <Draggable key={project.id} draggableId={project.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-lg p-3 transition-shadow ${
                                  snapshot.isDragging
                                    ? 'shadow-lg ring-2 ring-[var(--ff-accent)]'
                                    : 'shadow-sm hover:shadow-md'
                                }`}
                              >
                                {/* Drag Handle */}
                                <div
                                  {...provided.dragHandleProps}
                                  className="flex items-center gap-2 mb-2 cursor-grab active:cursor-grabbing"
                                >
                                  <GripVertical className="w-4 h-4 text-[var(--ff-text-secondary)]" />
                                  <Link
                                    href={`/pipeline/${project.id}`}
                                    className="text-sm font-medium text-[var(--ff-text-primary)] hover:text-[var(--ff-accent)] line-clamp-1"
                                  >
                                    {project.project_name}
                                  </Link>
                                </div>

                                {/* Project Code */}
                                <p className="text-xs text-[var(--ff-text-secondary)] mb-2">
                                  {project.project_code}
                                </p>

                                {/* Details */}
                                <div className="space-y-1 text-xs text-[var(--ff-text-secondary)]">
                                  {project.client_name && (
                                    <div className="flex items-center gap-1.5">
                                      <Building2 className="w-3.5 h-3.5" />
                                      <span className="truncate">{project.client_name}</span>
                                    </div>
                                  )}
                                  {project.estimated_value && (
                                    <div className="flex items-center gap-1.5">
                                      <DollarSign className="w-3.5 h-3.5" />
                                      <span>{formatCurrency(project.estimated_value)}</span>
                                    </div>
                                  )}
                                </div>

                                {/* Approvals Progress */}
                                {project.total_required_approvals > 0 && (
                                  <div className="mt-2 pt-2 border-t border-[var(--ff-border-light)]">
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs text-[var(--ff-text-secondary)]">
                                        Approvals
                                      </span>
                                      <span className="text-xs font-medium text-[var(--ff-text-primary)]">
                                        {project.completed_approvals}/{project.total_required_approvals}
                                      </span>
                                    </div>
                                    <div className="h-1.5 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                                      <div
                                        className={`h-full ${
                                          project.expired_approvals > 0
                                            ? 'bg-red-500'
                                            : project.completed_approvals === project.total_required_approvals
                                            ? 'bg-green-500'
                                            : 'bg-blue-500'
                                        }`}
                                        style={{
                                          width: `${Math.round(
                                            (project.completed_approvals / project.total_required_approvals) * 100
                                          )}%`,
                                        }}
                                      />
                                    </div>
                                    {project.expired_approvals > 0 && (
                                      <div className="flex items-center gap-1 mt-1 text-xs text-red-500">
                                        <AlertTriangle className="w-3 h-3" />
                                        {project.expired_approvals} expired
                                      </div>
                                    )}
                                  </div>
                                )}
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
            </div>
          ))}
        </div>
      </DragDropContext>

      {/* Closed/Completed Projects Section */}
      {closedProjects.length > 0 && (
        <div className="border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)]">
          <button
            onClick={() => setShowClosed(!showClosed)}
            className="w-full px-4 py-3 flex items-center justify-between text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors"
          >
            <span className="font-medium">
              Closed Projects ({closedProjects.length})
            </span>
            {showClosed ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </button>
          {showClosed && (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {closedProjects.map(project => (
                  <Link
                    key={project.id}
                    href={`/pipeline/${project.id}`}
                    className="p-3 bg-[var(--ff-card-bg)] border border-[var(--ff-border-light)] rounded-lg hover:shadow-md transition-shadow"
                  >
                    <p className="font-medium text-[var(--ff-text-primary)] text-sm truncate">
                      {project.project_name}
                    </p>
                    <p className="text-xs text-[var(--ff-text-secondary)]">
                      {project.project_code}
                    </p>
                    <div className="mt-2">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          project.pipeline_status === 'planned'
                            ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300'
                            : project.pipeline_status === 'on_hold'
                            ? 'bg-secondary/30 text-muted-foreground'
                            : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                        }`}
                      >
                        {project.pipeline_status === 'planned' && 'Planned'}
                        {project.pipeline_status === 'on_hold' && 'On Hold'}
                        {project.pipeline_status === 'cancelled' && 'Cancelled'}
                        {project.pipeline_status === 'lost' && 'Lost'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PipelineKanban;
