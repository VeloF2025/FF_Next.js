// 🟢 WORKING: ProjectWorkflowList component - displays and manages active project workflows
import { useState } from 'react';
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
        return <Clock className="w-4 h-4 text-gray-600 dark:text-gray-400" />;
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
        return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:bg-gray-800 dark:text-gray-400';
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
        <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
          <Calendar className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          No Active Workflows
        </h3>
        <p className="text-gray-600 dark:text-gray-400 text-center max-w-md mb-4">
          Start managing your project workflows by assigning templates to projects. 
          Track progress, manage teams, and monitor execution.
        </p>
        <button
          onClick={() => onAssignWorkflow('')}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          Assign First Workflow
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* View Mode Toggle */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              Timeline View
            </button>
          </div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
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
              <div key={workflow.id} className="bg-white dark:bg-gray-900">
                <div className="p-6 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-start justify-between">
                    {/* Main Workflow Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(workflow.status)}
                          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 truncate">
                            {workflow.name}
                          </h3>
                        </div>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(workflow.status)}`}>
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
                          <p className="text-sm text-gray-500 dark:text-gray-400">Project</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {workflow.project?.name || 'Unknown Project'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Template</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {workflow.template?.name || 'Unknown Template'}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Assigned To</p>
                          <div className="flex items-center space-x-1">
                            <User className="w-4 h-4 text-gray-400" />
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {workflow.assignedUser?.name || 'Unassigned'}
                            </p>
                          </div>
                        </div>
                        <div>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Team Size</p>
                          <div className="flex items-center space-x-1">
                            <Users className="w-4 h-4 text-gray-400" />
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
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
                      <div className="flex items-center space-x-6 mt-3 text-sm text-gray-600 dark:text-gray-400">
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
                      <button
                        onClick={() => handleActionClick('view', workflow.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleActionClick('edit', workflow.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Edit Workflow"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleActionClick('timeline', workflow.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        title="Toggle Timeline"
                      >
                        <Calendar className="w-4 h-4" />
                      </button>
                      <div className="relative">
                        <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {/* TODO: Add dropdown menu for more actions */}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Timeline View */}
                {expandedWorkflow === workflow.id && (
                  <div className="px-6 pb-6 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
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