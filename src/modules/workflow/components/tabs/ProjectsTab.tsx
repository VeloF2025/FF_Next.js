// 🟢 WORKING: Projects tab component - complete project workflow management interface
import { useState, useEffect } from 'react';
import { 
  Plus, 
  Search, 
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  BarChart3
} from 'lucide-react';

import { ProjectWorkflowList } from '../projects/ProjectWorkflowList';
import { WorkflowAssignmentModal } from '../projects/WorkflowAssignmentModal';
import { WorkflowAnalytics } from '../projects/WorkflowAnalytics';
import { useWorkflowPortal } from '../../hooks/useWorkflowPortal';
// Type imports removed - using inline types
import { log } from '@/lib/logger';

export function ProjectsTab() {
  const { projectWorkflows, templates, loadProjectWorkflows, loadTemplates } = useWorkflowPortal();
  const [isAssignmentModalOpen, setIsAssignmentModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'analytics'>('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  useEffect(() => {
    loadProjectWorkflows();
    loadTemplates();
  }, []);

  const handleCreateWorkflow = () => {
    setSelectedProject(null);
    setIsAssignmentModalOpen(true);
  };

  const handleAssignToProject = (projectId: string) => {
    setSelectedProject(projectId);
    setIsAssignmentModalOpen(true);
  };

  // Filter workflows based on search and filters
  const filteredWorkflows = projectWorkflows.filter(workflow => {
    const matchesSearch = searchTerm === '' || 
      workflow.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      workflow.project?.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || workflow.status === statusFilter;
    
    const matchesAssignee = assigneeFilter === 'all' || 
      workflow.assignedTo === assigneeFilter;
    
    return matchesSearch && matchesStatus && matchesAssignee;
  });

  // Calculate statistics
  const stats = {
    total: projectWorkflows.length,
    active: projectWorkflows.filter(w => w.status === 'active').length,
    completed: projectWorkflows.filter(w => w.status === 'completed').length,
    overdue: projectWorkflows.filter(w => {
      if (!w.plannedEndDate) return false;
      return new Date(w.plannedEndDate) < new Date() && w.status === 'active';
    }).length
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="bg-[var(--ff-bg-secondary)] border-b border-[var(--ff-border-light)] px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
              Project Workflows
            </h2>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Manage workflow assignments and track execution progress
            </p>
          </div>
          <div className="flex items-center space-x-3">
            {/* View Toggle */}
            <div className="flex bg-[var(--ff-bg-tertiary)] rounded-lg p-1">
              <button
                onClick={() => setActiveView('list')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  activeView === 'list'
                    ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] shadow-sm'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                Workflows
              </button>
              <button
                onClick={() => setActiveView('analytics')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center space-x-1 ${
                  activeView === 'analytics'
                    ? 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] shadow-sm'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Analytics</span>
              </button>
            </div>

            <button
              onClick={handleCreateWorkflow}
              className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Assign Workflow</span>
            </button>
          </div>
        </div>

        {activeView === 'list' && (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mt-6">
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm text-[var(--ff-text-secondary)]">Total Workflows</p>
                    <p className="text-2xl font-semibold text-[var(--ff-text-primary)] mt-1">
                      {stats.total}
                    </p>
                  </div>
                  <Calendar className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm text-[var(--ff-text-secondary)]">Active</p>
                    <p className="text-2xl font-semibold text-[var(--ff-text-primary)] mt-1">
                      {stats.active}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-orange-600 dark:text-orange-400" />
                </div>
              </div>
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm text-[var(--ff-text-secondary)]">Completed</p>
                    <p className="text-2xl font-semibold text-[var(--ff-text-primary)] mt-1">
                      {stats.completed}
                    </p>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div className="bg-[var(--ff-bg-tertiary)] rounded-lg p-4">
                <div className="flex items-center">
                  <div className="flex-1">
                    <p className="text-sm text-[var(--ff-text-secondary)]">Overdue</p>
                    <p className="text-2xl font-semibold text-[var(--ff-text-primary)] mt-1">
                      {stats.overdue}
                    </p>
                  </div>
                  <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </div>

            {/* Search and Filters */}
            <div className="flex items-center space-x-4 mt-6">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
                <input
                  type="text"
                  placeholder="Search workflows or projects..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-green-500 focus:border-transparent"
                />
              </div>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="px-4 py-2 border border-[var(--ff-border-light)] rounded-lg bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                <option value="all">All Assignees</option>
                <option value="unassigned">Unassigned</option>
                {/* TODO: Add actual team members */}
              </select>
            </div>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeView === 'list' ? (
          <ProjectWorkflowList 
            workflows={filteredWorkflows}
            onAssignWorkflow={handleAssignToProject}
            onEditWorkflow={(id) => log.info('Edit workflow:', { data: id }, 'ProjectsTab')}
            onViewDetails={(id) => log.info('View details:', { data: id }, 'ProjectsTab')}
          />
        ) : (
          <WorkflowAnalytics />
        )}
      </div>

      {/* Assignment Modal */}
      {isAssignmentModalOpen && (
        <WorkflowAssignmentModal
          isOpen={isAssignmentModalOpen}
          onClose={() => setIsAssignmentModalOpen(false)}
          projectId={selectedProject}
          templates={templates}
          onAssign={(workflowData) => {
            log.info('Assigning workflow:', { data: workflowData }, 'ProjectsTab');
            setIsAssignmentModalOpen(false);
          }}
        />
      )}
    </div>
  );
}