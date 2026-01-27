'use client';

import { useRouter } from 'next/router';
import { Eye, Edit, Trash2 } from 'lucide-react';

interface ProjectTableProps {
  projects: any[] | undefined;
  isLoading: boolean;
  error: Error | null | undefined;
  onDelete?: (id: string) => void;
}

export function ProjectTable({ projects, isLoading, error, onDelete }: ProjectTableProps) {
  const router = useRouter();

  const formatLocation = (project: any) => {
    if (project.city) {
      return `${project.city}, ${project.province || project.state || ''}`.replace(/,\s*$/, '');
    }
    if (project.location) {
      // Handle JSON location strings
      try {
        const loc = typeof project.location === 'string' ? JSON.parse(project.location) : project.location;
        if (loc?.city) return `${loc.city}, ${loc.province || loc.region || ''}`.replace(/,\s*$/, '');
      } catch {
        // Not JSON, return as-is if it's a reasonable string
        if (project.location.length < 100) return project.location;
      }
    }
    return 'N/A';
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency',
      currency: 'ZAR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, string> = {
      planning: 'bg-blue-500/20 text-blue-400',
      in_progress: 'bg-green-500/20 text-green-400',
      active: 'bg-green-500/20 text-green-400',
      on_hold: 'bg-yellow-500/20 text-yellow-400',
      completed: 'bg-gray-500/20 text-gray-400',
      cancelled: 'bg-red-500/20 text-red-400',
    };

    const key = (status || '').toLowerCase();
    const displayStatus = status?.replace('_', ' ');
    return (
      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusConfig[key] || 'bg-gray-500/20 text-gray-400'}`}>
        {displayStatus}
      </span>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const priorityConfig: any = {
      LOW: 'bg-gray-500/20 text-gray-400',
      MEDIUM: 'bg-yellow-500/20 text-yellow-400',
      HIGH: 'bg-orange-500/20 text-orange-400',
      CRITICAL: 'bg-red-500/20 text-red-400',
    };

    return (
      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${priorityConfig[priority] || 'bg-gray-500/20 text-gray-400'}`}>
        {priority?.toLowerCase()}
      </span>
    );
  };

  return (
    <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
          <thead className="bg-[var(--ff-bg-tertiary)]">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Project
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Client
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Location
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Priority
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Duration
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Budget
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  Loading projects...
                </td>
              </tr>
            )}

            {error && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-red-600">
                  Error loading projects: {error.message}
                </td>
              </tr>
            )}

            {projects && projects.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
                  No projects found
                </td>
              </tr>
            )}

            {projects?.map((project) => (
              <tr
                key={project.id}
                className="hover:bg-[var(--ff-bg-hover)]"
              >
                <td className="px-4 py-4 whitespace-nowrap">
                  <div>
                    <div className="text-sm font-medium text-[var(--ff-text-primary)]">{project.name}</div>
                    <div className="text-sm text-[var(--ff-text-secondary)]">{project.project_code || project.code || `PRJ-${project.id.slice(0, 6)}`}</div>
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--ff-text-primary)]">{project.client_name || 'N/A'}</div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--ff-text-primary)]">
                    {formatLocation(project)}
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  {getStatusBadge(project.status)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  {getPriorityBadge(project.priority)}
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm text-[var(--ff-text-primary)]">
                    {formatDate(project.start_date)} - {formatDate(project.end_date)}
                  </div>
                </td>
                <td className="px-4 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                    {formatCurrency(Number(project.budget_allocated || project.budget))}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() => router.push(`/projects/${project.id}`)}
                      className="text-blue-500 hover:text-blue-600"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => router.push(`/projects/${project.id}/edit`)}
                      className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    {onDelete && (
                      <button
                        onClick={() => onDelete(project.id)}
                        className="text-red-500 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}