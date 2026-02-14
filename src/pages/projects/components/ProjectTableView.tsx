/**
 * Project Table View Component
 * Tabular display of projects with sorting and actions
 */

import { Project } from '@/types/project.types';
import { ProjectTableColumn, statusColors, priorityColors } from '../types';
import { formatCurrency, formatDate, formatProgressPercentage } from '../utils/formatters';
import { StandardDataTable } from '@/components/ui/StandardDataTable';

interface ProjectTableViewProps {
  projects: Project[];
  isLoading: boolean;
  onProjectView: (id: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status as keyof typeof statusColors] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ') : 'Unknown'}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityColors[priority as keyof typeof priorityColors] || 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200'}`}>
      {priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : 'Normal'}
    </span>
  );
}

export function ProjectTableView({ projects, isLoading, onProjectView }: ProjectTableViewProps) {
  const tableColumns: ProjectTableColumn[] = [
    { key: 'name', header: 'Project Name' },
    { key: 'code', header: 'Code' },
    { key: 'clientName', header: 'Client' },
    { 
      key: 'status', 
      header: 'Status',
      render: (project: Project) => <StatusBadge status={project.status} />
    },
    { 
      key: 'priority', 
      header: 'Priority',
      render: (project: Project) => <PriorityBadge priority={project.priority} />
    },
    { 
      key: 'actualProgress', 
      header: 'Progress',
      render: (project: Project) => (
        <div className="w-full">
          <div className="flex justify-between text-sm mb-1">
            <span>{formatProgressPercentage(project.actualProgress)}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full"
              style={{ width: `${project.actualProgress || 0}%` }}
            />
          </div>
        </div>
      )
    },
    { 
      key: 'endDate', 
      header: 'Due Date',
      render: (project: Project) => formatDate(project.endDate)
    },
    { 
      key: 'budget', 
      header: 'Budget',
      render: (project: Project) => formatCurrency(project.budget || 0)
    }
  ];

  return (
    <StandardDataTable
      data={projects}
      columns={tableColumns}
      isLoading={isLoading}
      onRowClick={(project: Project) => onProjectView(project.id!)}
      getRowKey={(project: Project) => project.id!}
    />
  );
}