// 🟢 WORKING: Visual workflow node components for phases, steps, and tasks
import React, { memo, useMemo } from 'react';
import { 
  PlayCircle, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Users, 
  FileText, 
  Settings,
  Grip
} from 'lucide-react';
import type { EditorNode, EditorPosition } from '../../context/WorkflowEditorContext';
import type { WorkflowPhase, WorkflowStep, WorkflowTask } from '../../types/workflow.types';

interface WorkflowNodeProps {
  node: EditorNode;
  position: EditorPosition;
  scale: number;
  isSelected: boolean;
  isDragging: boolean;
  onMouseDown: (event: React.MouseEvent) => void;
}

// Get node type-specific styling and icons
function getNodeStyle(type: 'phase' | 'step' | 'task', isSelected: boolean, isDragging: boolean) {
  const baseClasses = "transition-all duration-200 border-2 rounded-lg shadow-sm cursor-move select-none";
  
  const typeStyles = {
    phase: {
      width: 'w-64',
      height: 'min-h-24',
      bg: 'bg-gradient-to-r from-blue-500 to-blue-600',
      bgHover: 'hover:from-blue-600 hover:to-blue-700',
      border: isSelected ? 'border-blue-300' : 'border-blue-400',
      text: 'text-white',
      icon: PlayCircle
    },
    step: {
      width: 'w-52',
      height: 'min-h-20',
      bg: 'bg-gradient-to-r from-green-500 to-green-600',
      bgHover: 'hover:from-green-600 hover:to-green-700',
      border: isSelected ? 'border-green-300' : 'border-green-400',
      text: 'text-white',
      icon: Settings
    },
    task: {
      width: 'w-40',
      height: 'min-h-16',
      bg: 'bg-gradient-to-r from-purple-500 to-purple-600',
      bgHover: 'hover:from-purple-600 hover:to-purple-700',
      border: isSelected ? 'border-purple-300' : 'border-purple-400',
      text: 'text-white',
      icon: FileText
    }
  };

  const style = typeStyles[type];
  
  let classes = `${baseClasses} ${style.width} ${style.height} ${style.bg} ${style.bgHover} ${style.border} ${style.text}`;
  
  if (isSelected) {
    classes += ' ring-2 ring-blue-300 ring-opacity-50';
  }
  
  if (isDragging) {
    classes += ' scale-105 shadow-lg z-50';
  }

  return { classes, icon: style.icon };
}

// Phase Node Component
const PhaseNode = memo(({ data, isSelected, isDragging }: { 
  data: WorkflowPhase; 
  isSelected: boolean; 
  isDragging: boolean;
}) => {
  const { classes, icon: Icon } = getNodeStyle('phase', isSelected, isDragging);
  
  return (
    <div className={classes}>
      {/* Node Header */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2 flex-1">
            <Icon className="w-5 h-5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{data.name}</h3>
              {data.description && (
                <p className="text-xs opacity-90 mt-1 line-clamp-2">{data.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-1 ml-2">
            <Grip className="w-4 h-4 opacity-60" />
          </div>
        </div>

        {/* Phase Metadata */}
        <div className="flex items-center justify-between mt-3 text-xs">
          <div className="flex items-center space-x-3">
            {data.estimatedDuration && (
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{data.estimatedDuration}d</span>
              </div>
            )}
            {data.requiredRoles && data.requiredRoles.length > 0 && (
              <div className="flex items-center space-x-1">
                <Users className="w-3 h-3" />
                <span>{data.requiredRoles.length}</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-1">
            {data.isOptional && (
              <span className="px-1.5 py-0.5 bg-card/20 rounded text-xs">Optional</span>
            )}
            {data.isParallel && (
              <span className="px-1.5 py-0.5 bg-card/20 rounded text-xs">Parallel</span>
            )}
          </div>
        </div>

        {/* Progress Bar (placeholder) */}
        <div className="mt-2">
          <div className="bg-card/20 rounded-full h-1.5">
            <div className="bg-card rounded-full h-1.5 w-0" />
          </div>
        </div>
      </div>
    </div>
  );
});

// Step Node Component  
const StepNode = memo(({ data, isSelected, isDragging }: { 
  data: WorkflowStep; 
  isSelected: boolean; 
  isDragging: boolean;
}) => {
  const { classes, icon: Icon } = getNodeStyle('step', isSelected, isDragging);
  
  const getStepTypeIcon = (stepType: string) => {
    switch (stepType) {
      case 'approval': return CheckCircle;
      case 'review': return AlertCircle;
      case 'milestone': return PlayCircle;
      default: return Settings;
    }
  };

  const StepIcon = getStepTypeIcon(data.stepType);
  
  return (
    <div className={classes}>
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2 flex-1">
            <StepIcon className="w-4 h-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium text-sm truncate">{data.name}</h4>
              {data.description && (
                <p className="text-xs opacity-80 mt-0.5 line-clamp-1">{data.description}</p>
              )}
            </div>
          </div>
          <Grip className="w-3 h-3 opacity-60 ml-1" />
        </div>

        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center space-x-2">
            {data.estimatedDuration && (
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{data.estimatedDuration}h</span>
              </div>
            )}
            {data.assigneeRole && (
              <div className="flex items-center space-x-1">
                <Users className="w-3 h-3" />
                <span className="truncate max-w-16">{data.assigneeRole}</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-1">
            {!data.isRequired && (
              <span className="px-1 py-0.5 bg-card/20 rounded text-xs">Optional</span>
            )}
            {data.isAutomated && (
              <span className="px-1 py-0.5 bg-card/20 rounded text-xs">Auto</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// Task Node Component
const TaskNode = memo(({ data, isSelected, isDragging }: { 
  data: WorkflowTask; 
  isSelected: boolean; 
  isDragging: boolean;
}) => {
  const { classes, icon: Icon } = getNodeStyle('task', isSelected, isDragging);
  
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-[var(--ff-text-tertiary)]';
      default: return 'bg-[var(--ff-text-tertiary)]';
    }
  };

  return (
    <div className={classes}>
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2 flex-1">
            <Icon className="w-4 h-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h5 className="font-medium text-xs truncate">{data.name}</h5>
              {data.description && (
                <p className="text-xs opacity-80 mt-0.5 line-clamp-1">{data.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-1 ml-1">
            <div className={`w-2 h-2 rounded-full ${getPriorityColor(data.priority)}`} title={`Priority: ${data.priority}`} />
            <Grip className="w-3 h-3 opacity-60" />
          </div>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center space-x-2">
            {data.estimatedHours && (
              <div className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>{data.estimatedHours}h</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center space-x-1">
            {data.isOptional && (
              <span className="px-1 py-0.5 bg-card/20 rounded text-xs">Opt</span>
            )}
            {data.canBeParallel && (
              <span className="px-1 py-0.5 bg-card/20 rounded text-xs">Par</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// Main WorkflowNode Component
export const WorkflowNode = memo(({
  node,
  position,
  isSelected,
  isDragging,
  onMouseDown
}: WorkflowNodeProps) => {
  
  // Memoize the node component based on type
  const NodeComponent = useMemo(() => {
    switch (node.type) {
      case 'phase':
        return <PhaseNode data={node.data as WorkflowPhase} isSelected={isSelected} isDragging={isDragging} />;
      case 'step':
        return <StepNode data={node.data as WorkflowStep} isSelected={isSelected} isDragging={isDragging} />;
      case 'task':
        return <TaskNode data={node.data as WorkflowTask} isSelected={isSelected} isDragging={isDragging} />;
      default:
        return null;
    }
  }, [node.type, node.data, isSelected, isDragging]);

  // Apply scaling and positioning
  const nodeStyle = useMemo(() => ({
    position: 'absolute' as const,
    left: `${position.x}px`,
    top: `${position.y}px`,
    transformOrigin: 'top left',
    zIndex: isSelected ? 10 : isDragging ? 50 : 1,
  }), [position.x, position.y, isSelected, isDragging]);

  return (
    <div
      style={nodeStyle}
      onMouseDown={onMouseDown}
      className="workflow-node"
    >
      {NodeComponent}
      
      {/* Connection Points */}
      <div className="absolute -left-2 top-1/2 w-4 h-4 bg-[var(--ff-bg-secondary)] border-2 border-[var(--ff-border-light)] rounded-full transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
           title="Input connection point" />
      <div className="absolute -right-2 top-1/2 w-4 h-4 bg-[var(--ff-bg-secondary)] border-2 border-[var(--ff-border-light)] rounded-full transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
           title="Output connection point" />
    </div>
  );
});

WorkflowNode.displayName = 'WorkflowNode';
PhaseNode.displayName = 'PhaseNode';
StepNode.displayName = 'StepNode';
TaskNode.displayName = 'TaskNode';

export default WorkflowNode;