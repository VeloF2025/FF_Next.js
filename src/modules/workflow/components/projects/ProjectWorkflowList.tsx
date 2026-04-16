// 🟢 WORKING: ProjectWorkflowList component - displays and manages active project workflows
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  CheckCircle2,
  Clock,
  Calendar,
  User,
  Users,
  MoreVertical,
  Eye,
  Edit2,
  AlertCircle,
  TrendingUp
} from 'lucide-react';

import { WorkflowProgress } from './WorkflowProgress';
import { WorkflowTimeline } from './WorkflowTimeline';
import type { ProjectWorkflow } from '../../types/workflow.types';
import { formatDate } from '../../../../utils/dateHelpers';
import { log } from '@/lib/logger';

interface ProjectWorkflowListProps {
  workflows: ProjectWorkflow[];
  onAssignWorkflow: (projectId: string) => void;
  onEditWorkflow: (workflowId: string) => void;
  onViewDetails: (workflowId: string) => void;
}

export function ProjectWorkflowList({ 
  workflows, 
  onAssignWorkflow, 
  onEditWorkflow, 
  onViewDetails 
}: ProjectWorkflowListProps) {
  // Workflow selection state removed - not used in current implementation
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [expandedWorkflow, setExpandedWorkflow] = useState<string | null>(null);

  const getStatusIcon = (status: ProjectWorkflow['status']) => {
    switch (status) {
      case 'active':
        return <Play className="w-4 h-4 text-green-600" />;
      case 'paused':
        return <Pause className="w-4 h-4 text-yellow-600" />;
      case 'completed':
        return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: ProjectWorkflow['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400';
      case 'paused':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400';
      case 'completed':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400';
      case 'cancelled':
        return 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400';
      default:
        return 'bg-secondary text-gray-800 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  const isOverdue = (workflow: ProjectWorkflow) => {
    if (!workflow.plannedEndDate || workflow.status === 'completed') return false;
    return new Date(workflow.plannedEndDate) < new Date();
  };

  const handleActionClick = (action: string, workflowId: string) => {
    switch (action) {
      case 'view':
        onViewDetails(workflowId);
        break;
      case 'edit':
        onEditWorkflow(workflowId);
        break;
      case 'timeline':
        setExpandedWorkflow(expandedWorkflow === workflowId ? null : workflowId);
        break;
      default:
        log.info(`Action ${action} for workflow ${workflowId}`, undefined, 'ProjectWorkflowList');
    }
  };

  if (workflows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mb-4">
          <Calendar className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          No Active Workflows
        </h3>
        <p className="text-muted-foreground text-center max-w-md mb-4">
          Start managing your project workflows by assigning templates to projects. 
          Track progress, manage teams, and monitor execution.
        </p>
        <Button variant="primary" onClick={() => onAssignWorkflow('')}>
          Assign First Workflow
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* View Mode Toggle */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-background">
        <div className="flex items-center justify-between">
          <div className="flex bg-secondary rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Timeline View
            </button>
          </div>
          <span className="text-sm text-muted-foreground">
            {workflows.length} workflows
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {viewMode === 'timeline' ? (
          <WorkflowTimeline workflows={workflows} />
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-800">
            {workflows.map((workflow) => (
              <div key={workflow.id} className="bg-background">
                <div className="p-6 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start justify-between">
                    {/* Main Workflow Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(workflow.status)}
                          <h3 className="text-lg font-medium text-foreground truncate">
                            {workflow.name}
                          </h3>
                        </div>
                        <span aria-label={`Status: ${workflow.status}`} className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(workflow.status)}`}>
                          {workflow.status.charAt(0).toUpperCase() + workflow.status.slice(1)}
                        </span>
                        {isOverdue(workflow) && (
                          <span className="inline-flex items-center space-x-1 text-red-600 dark:text-red-400 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            <span>Overdue</span>
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Project</p>
                          <p className="text-sm font-medium text-foreground">
                            {workflow.project?.name || 'Unknown Project'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Template</p>
                          <p className="text-sm font-medium text-foreground">
                            {workflow.template?.name || 'Unknown Template'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Assigned To</p>
                          <div className="flex items-center space-x-1">
                            <User className="w-4 h-4 text-gray-400" />
                            <p className="text-sm font-medium text-foreground">
                              {workflow.assignedUser?.name || 'Unassigned'}
                            </p>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Team Size</p>
                          <div className="flex items-center space-x-1">
                            <Users className="w-4 h-4 text-gray-400" />
                            <p className="text-sm font-medium text-foreground">
                              {workflow.teamMembers.length} members
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <WorkflowProgress 
                        workflow={workflow} 
                        compact={true}
                      />

                      {/* Timeline Info */}
                      <div className="flex items-center space-x-6 mt-3 text-sm text-muted-foreground">
                        <div className="flex items-center space-x-1">
                          <Calendar className="w-4 h-4" />
                          <span>
                            {workflow.startDate 
                              ? `Started ${formatDate(workflow.startDate)}`
                              : 'Not started'
                            }
                          </span>
                        </div>
                        {workflow.plannedEndDate && (
                          <div className="flex items-center space-x-1">
                            <Clock className="w-4 h-4" />
                            <span>
                              Due {formatDate(workflow.plannedEndDate)}
                            </span>
                          </div>
                        )}
                        {workflow.currentPhase && (
                          <div className="flex items-center space-x-1">
                            <TrendingUp className="w-4 h-4" />
                            <span>
                              Current: {workflow.currentPhase.name}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions Menu */}
                    <div className="flex items-center space-x-2 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleActionClick('view', workflow.id)}
                        title="View Details"
                        aria-label="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleActionClick('edit', workflow.id)}
                        title="Edit Workflow"
                        aria-label="Edit workflow"
                      >
                        <Edit2 className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleActionClick('timeline', workflow.id)}
                        title="Toggle Timeline"
                        aria-label="Toggle timeline"
                      >
                        <Calendar className="w-4 h-4" />
                      </Button>
                      <div className="relative">
                        <Button variant="ghost" size="icon" aria-label="More actions">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                        {/* TODO: Add dropdown menu for more actions */}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Timeline View */}
                {expandedWorkflow === workflow.id && (
                  <div className="px-6 pb-6 border-t border-gray-200 dark:border-gray-800 bg-input/50">
                    <WorkflowTimeline 
                      workflows={[workflow]} 
                      compact={true}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}