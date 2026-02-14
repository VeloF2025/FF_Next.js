// 🟢 WORKING: WorkflowProgress component - displays workflow execution progress
import { useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  Pause,
  Circle
} from 'lucide-react';

import type { ProjectWorkflow } from '../../types/workflow.types';

interface WorkflowProgressProps {
  workflow: ProjectWorkflow;
  compact?: boolean;
  showPhases?: boolean;
}

export function WorkflowProgress({ workflow, compact = false, showPhases = true }: WorkflowProgressProps) {
  // Mock phase data - in real implementation this would come from the workflow
  const phases = workflow.template?.phases || [];
  const currentPhaseIndex = phases.findIndex(phase => phase.id === workflow.currentPhaseId) || 0;
  
  // Calculate progress for each phase
  const phaseProgress = phases.map((phase, index) => {
    if (index < currentPhaseIndex) {
      return { ...phase, status: 'completed', progress: 100 };
    } else if (index === currentPhaseIndex) {
      return { ...phase, status: 'active', progress: workflow.progressPercentage || 0 };
    } else {
      return { ...phase, status: 'pending', progress: 0 };
    }
  });

  const getPhaseIcon = (status: string, progress: number) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'active':
        return progress > 0 ? (
          <div className="relative">
            <Circle className="w-4 h-4 text-blue-600" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
            </div>
          </div>
        ) : (
          <Play className="w-4 h-4 text-blue-600" />
        );
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-600" />;
      case 'pending':
        return <Circle className="w-4 h-4 text-gray-400" />;
      default:
        return <Circle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getPhaseColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'border-green-500 bg-green-50 dark:bg-green-900/20';
      case 'active':
        return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20';
      case 'paused':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20';
      case 'pending':
        return 'border-border bg-input';
      default:
        return 'border-border bg-input';
    }
  };

  if (compact) {
    return (
      <div className="space-y-2">
        {/* Overall Progress Bar */}
        <div className="flex items-center space-x-3">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-muted-foreground">Progress</span>
              <span className="text-sm font-medium text-foreground">
                {Math.round(workflow.progressPercentage || 0)}%
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-green-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${workflow.progressPercentage || 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Phase Indicators */}
        {showPhases && phases.length > 0 && (
          <div className="flex items-center space-x-2">
            {phaseProgress.map((phase, index) => (
              <div key={phase.id} className="flex items-center">
                <div 
                  className={`flex items-center justify-center w-6 h-6 rounded-full border-2 ${getPhaseColor(phase.status)}`}
                  title={`${phase.name} - ${phase.progress}%`}
                >
                  <div className="w-2 h-2 rounded-full bg-current opacity-60" />
                </div>
                {index < phases.length - 1 && (
                  <div className="w-4 h-0.5 bg-muted mx-1" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Progress */}
      <div className="bg-background rounded-lg p-4 border border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-foreground">
            Overall Progress
          </h3>
          <div className="text-right">
            <div className="text-2xl font-bold text-foreground">
              {Math.round(workflow.progressPercentage || 0)}%
            </div>
            <div className="text-sm text-muted-foreground">
              Complete
            </div>
          </div>
        </div>
        
        <div className="w-full bg-secondary rounded-full h-3">
          <div 
            className="bg-gradient-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-500"
            style={{ width: `${workflow.progressPercentage || 0}%` }}
          />
        </div>
        
        {workflow.currentPhase && (
          <div className="flex items-center space-x-2 mt-3 text-sm text-muted-foreground">
            <Play className="w-4 h-4" />
            <span>Currently in: {workflow.currentPhase.name}</span>
          </div>
        )}
      </div>

      {/* Phase Progress */}
      {showPhases && phases.length > 0 && (
        <div className="bg-background rounded-lg p-4 border border-border">
          <h3 className="text-lg font-medium text-foreground mb-4">
            Phase Progress
          </h3>
          
          <div className="space-y-4">
            {phaseProgress.map((phase, index) => (
              <div key={phase.id} className="flex items-center space-x-4">
                {/* Phase Icon and Status */}
                <div className="flex items-center space-x-2 w-48">
                  {getPhaseIcon(phase.status, phase.progress)}
                  <div className="flex-1">
                    <div className="text-sm font-medium text-foreground truncate">
                      {phase.name}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {phase.status}
                    </div>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-muted-foreground">
                      {phase.estimatedDuration ? `${phase.estimatedDuration} days` : 'Duration TBD'}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {Math.round(phase.progress)}%
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        phase.status === 'completed' 
                          ? 'bg-green-500' 
                          : phase.status === 'active' 
                            ? 'bg-blue-500' 
                            : 'bg-gray-400'
                      }`}
                      style={{ width: `${phase.progress}%` }}
                    />
                  </div>
                </div>

                {/* Phase Actions */}
                <div className="flex items-center space-x-1">
                  {phase.status === 'active' && (
                    <button 
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                      title="Pause Phase"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                  )}
                  {phase.status === 'paused' && (
                    <button 
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                      title="Resume Phase"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-background rounded-lg p-4 border border-border">
          <div className="flex items-center space-x-2">
            <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="text-sm text-muted-foreground">Time Elapsed</div>
              <div className="text-lg font-semibold text-foreground">
                {workflow.startDate 
                  ? `${Math.ceil((new Date().getTime() - new Date(workflow.startDate).getTime()) / (1000 * 60 * 60 * 24))} days`
                  : 'Not started'
                }
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background rounded-lg p-4 border border-border">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <div>
              <div className="text-sm text-muted-foreground">Phases Complete</div>
              <div className="text-lg font-semibold text-foreground">
                {phaseProgress.filter(p => p.status === 'completed').length} / {phases.length}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-background rounded-lg p-4 border border-border">
          <div className="flex items-center space-x-2">
            <AlertCircle className={`w-5 h-5 ${
              workflow.plannedEndDate && new Date(workflow.plannedEndDate) < new Date()
                ? 'text-red-600 dark:text-red-400'
                : 'text-gray-400'
            }`} />
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="text-lg font-semibold text-foreground">
                {workflow.plannedEndDate && new Date(workflow.plannedEndDate) < new Date() && workflow.status === 'active'
                  ? 'Overdue'
                  : 'On Track'
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}