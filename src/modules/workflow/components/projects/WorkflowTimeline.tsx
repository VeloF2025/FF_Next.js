// 🟢 WORKING: WorkflowTimeline component - Gantt-style timeline visualization for workflows
import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Play
} from 'lucide-react';

import type { ProjectWorkflow, WorkflowPhase } from '../../types/workflow.types';
// formatDate imported but not used - using date formatting inline

interface WorkflowTimelineProps {
  workflows: ProjectWorkflow[];
  compact?: boolean;
  selectedWorkflowId?: string;
  onWorkflowSelect?: (workflowId: string) => void;
}

interface TimelineData {
  startDate: Date;
  endDate: Date;
  totalDays: number;
  dayWidth: number;
}

const PHASE_COLORS = [
  'bg-blue-500',
  'bg-green-500', 
  'bg-purple-500',
  'bg-orange-500',
  'bg-red-500',
  'bg-indigo-500',
  'bg-pink-500',
  'bg-teal-500'
];

export function WorkflowTimeline({ 
  workflows, 
  compact = false, 
  selectedWorkflowId, 
  onWorkflowSelect 
}: WorkflowTimelineProps) {
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);

  // Fix hydration: set date only on client
  useEffect(() => {
    setCurrentDate(new Date());
  }, []);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = normal, 2 = zoomed in

  useEffect(() => {
    if (workflows.length === 0) return;

    // Calculate timeline bounds
    const dates = workflows.flatMap(workflow => [
      workflow.startDate ? new Date(workflow.startDate) : new Date(),
      workflow.plannedEndDate ? new Date(workflow.plannedEndDate) : new Date()
    ]);

    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    // Add padding
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);

    const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
    const dayWidth = compact ? 2 : 3 * zoomLevel;

    setTimelineData({
      startDate: minDate,
      endDate: maxDate,
      totalDays,
      dayWidth
    });
  }, [workflows, compact, zoomLevel]);

  const getDatePosition = (date: Date): number => {
    if (!timelineData) return 0;
    const daysSinceStart = Math.ceil((date.getTime() - timelineData.startDate.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceStart * timelineData.dayWidth;
  };

  const getCurrentDatePosition = (): number => {
    if (!currentDate) return 0;
    return getDatePosition(currentDate);
  };

  const generateTimeHeaders = () => {
    if (!timelineData) return [];
    
    const headers = [];
    const current = new Date(timelineData.startDate);
    
    while (current <= timelineData.endDate) {
      headers.push({
        date: new Date(current),
        position: getDatePosition(current),
        isToday: current.toDateString() === new Date().toDateString()
      });
      
      if (compact || zoomLevel < 1.5) {
        current.setDate(current.getDate() + 7); // Weekly intervals
      } else {
        current.setDate(current.getDate() + 1); // Daily intervals
      }
    }
    
    return headers;
  };

  const getPhaseBarData = (workflow: ProjectWorkflow, phase: WorkflowPhase, phaseIndex: number) => {
    const startDate = workflow.startDate ? new Date(workflow.startDate) : new Date();
    const endDate = workflow.plannedEndDate ? new Date(workflow.plannedEndDate) : new Date();
    
    // Calculate phase duration based on estimated duration or equal distribution
    const totalDuration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const phaseDuration = phase.estimatedDuration || Math.ceil(totalDuration / (workflow.template?.phases?.length || 1));
    
    // Calculate phase start date
    const previousPhasesDuration = (workflow.template?.phases || [])
      .slice(0, phaseIndex)
      .reduce((sum, p) => sum + (p.estimatedDuration || phaseDuration), 0);
    
    const phaseStartDate = new Date(startDate);
    phaseStartDate.setDate(phaseStartDate.getDate() + previousPhasesDuration);
    
    const phaseEndDate = new Date(phaseStartDate);
    phaseEndDate.setDate(phaseEndDate.getDate() + phaseDuration);

    return {
      startPosition: getDatePosition(phaseStartDate),
      width: phaseDuration * (timelineData?.dayWidth || 3),
      startDate: phaseStartDate,
      endDate: phaseEndDate,
      duration: phaseDuration,
      color: PHASE_COLORS[phaseIndex % PHASE_COLORS.length]
    };
  };

  const getPhaseStatus = (workflow: ProjectWorkflow, _phase: WorkflowPhase, phaseIndex: number) => {
    const currentPhaseIndex = (workflow.template?.phases || []).findIndex(p => p.id === workflow.currentPhaseId);
    
    if (phaseIndex < currentPhaseIndex) return 'completed';
    if (phaseIndex === currentPhaseIndex) return 'active';
    return 'pending';
  };

  if (!timelineData || workflows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 p-8">
        <Calendar className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-4" />
        <h3 className="text-lg font-medium text-[var(--ff-text-primary)] mb-2">
          No Timeline Data
        </h3>
        <p className="text-[var(--ff-text-secondary)] text-center">
          Select workflows to view their timeline visualization
        </p>
      </div>
    );
  }

  const timeHeaders = generateTimeHeaders();
  const totalWidth = timelineData.totalDays * timelineData.dayWidth;

  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
      {/* Timeline Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)]">
        <div className="flex items-center space-x-4">
          <h3 className="text-lg font-medium text-[var(--ff-text-primary)]">
            Project Timeline
          </h3>
          <span className="text-sm text-[var(--ff-text-secondary)]">
            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setZoomLevel(Math.max(0.5, zoomLevel - 0.5))}
            className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] rounded"
            title="Zoom Out"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-[var(--ff-text-secondary)] min-w-12 text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel(Math.min(3, zoomLevel + 0.5))}
            className="p-2 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] rounded"
            title="Zoom In"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="relative overflow-x-auto">
        {/* Time Headers */}
        <div
          className="flex items-end border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] h-12 px-4"
          style={{ minWidth: Math.max(totalWidth + 300, 800) }}
        >
          <div className="w-64 flex-shrink-0" /> {/* Spacer for workflow names */}
          <div className="relative flex-1">
            {timeHeaders.map((header, index) => (
              <div
                key={index}
                className="absolute bottom-2 transform -translate-x-1/2"
                style={{ left: header.position }}
              >
                <div className={`text-xs font-medium ${
                  header.isToday ? 'text-red-600 dark:text-red-400' : 'text-[var(--ff-text-secondary)]'
                }`}>
                  {header.date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric'
                  })}
                </div>
              </div>
            ))}
            
            {/* Current Date Line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-75 z-10"
              style={{ left: getCurrentDatePosition() }}
            >
              <div className="absolute -top-1 -left-1 w-3 h-3 bg-red-500 rounded-full" />
            </div>
          </div>
        </div>

        {/* Workflow Rows */}
        <div style={{ minWidth: Math.max(totalWidth + 300, 800) }}>
          {workflows.map((workflow) => (
            <div
              key={workflow.id}
              className={`flex border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)] ${
                selectedWorkflowId === workflow.id ? 'bg-blue-50 dark:bg-blue-900/10' : ''
              }`}
              onClick={() => onWorkflowSelect?.(workflow.id)}
            >
              {/* Workflow Info */}
              <div className="w-64 flex-shrink-0 p-4 border-r border-[var(--ff-border-light)]">
                <div className="flex items-center space-x-2 mb-1">
                  <div className={`w-3 h-3 rounded-full ${
                    workflow.status === 'active' ? 'bg-green-500' :
                    workflow.status === 'completed' ? 'bg-blue-500' :
                    workflow.status === 'paused' ? 'bg-yellow-500' : 'bg-[var(--ff-text-tertiary)]'
                  }`} />
                  <h4 className="font-medium text-[var(--ff-text-primary)] text-sm truncate">
                    {workflow.name}
                  </h4>
                </div>
                <p className="text-xs text-[var(--ff-text-secondary)] truncate">
                  {workflow.project?.name}
                </p>
                <div className="flex items-center space-x-2 mt-2 text-xs text-[var(--ff-text-tertiary)]">
                  <Clock className="w-3 h-3" />
                  <span>{Math.round(workflow.progressPercentage || 0)}%</span>
                </div>
              </div>

              {/* Timeline Bars */}
              <div className="flex-1 relative p-4">
                <div className="relative h-8">
                  {(workflow.template?.phases || []).map((phase, phaseIndex) => {
                    const barData = getPhaseBarData(workflow, phase, phaseIndex);
                    const status = getPhaseStatus(workflow, phase, phaseIndex);
                    
                    return (
                      <div
                        key={phase.id}
                        className={`absolute h-6 rounded transition-all hover:shadow-md cursor-pointer ${
                          status === 'completed' ? 'opacity-90' :
                          status === 'active' ? 'opacity-100 ring-2 ring-white dark:ring-gray-900' :
                          'opacity-60'
                        }`}
                        style={{
                          left: barData.startPosition,
                          width: Math.max(barData.width, 20),
                          top: 4
                        }}
                        title={`${phase.name} (${barData.duration} days) - ${status}`}
                      >
                        <div className={`w-full h-full rounded ${barData.color} relative overflow-hidden`}>
                          {status === 'active' && (
                            <div
                              className="absolute inset-0 bg-[var(--ff-bg-secondary)] opacity-30"
                              style={{
                                width: `${100 - (workflow.progressPercentage || 0)}%`,
                                right: 0
                              }}
                            />
                          )}
                          
                          {/* Phase Label */}
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-white text-xs font-medium truncate px-2">
                              {phase.name}
                            </span>
                          </div>

                          {/* Status Icon */}
                          <div className="absolute top-0.5 right-1">
                            {status === 'completed' && (
                              <CheckCircle2 className="w-3 h-3 text-white opacity-75" />
                            )}
                            {status === 'active' && (
                              <Play className="w-3 h-3 text-white opacity-75" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline Legend */}
      {!compact && (
        <div className="flex items-center justify-between p-4 bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)]">
          <div className="flex items-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded" />
              <span className="text-[var(--ff-text-secondary)]">Active</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded" />
              <span className="text-[var(--ff-text-secondary)]">Completed</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-yellow-500 rounded" />
              <span className="text-[var(--ff-text-secondary)]">Paused</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-[var(--ff-text-tertiary)] rounded" />
              <span className="text-[var(--ff-text-secondary)]">Pending</span>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-sm text-[var(--ff-text-secondary)]">
            <div className="w-0.5 h-4 bg-red-500" />
            <span>Today</span>
          </div>
        </div>
      )}
    </div>
  );
}