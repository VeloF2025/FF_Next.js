/**
 * Recent Projects Table (PRD-058)
 * Displays recent project activity with quick navigation
 */

import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { RecentProject } from './types';

interface RecentProjectsTableProps {
  projects: RecentProject[];
  isLoading?: boolean;
}

/**
 * Get status badge styling
 */
function getStatusBadge(status: string): { bg: string; text: string; label: string } {
  const statusLower = status.toLowerCase();

  switch (statusLower) {
    case 'pipeline':
      return { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', label: 'Pipeline' };
    case 'planning':
    case 'planned':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', label: 'Planned' };
    case 'active':
    case 'in_progress':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', label: 'Active' };
    case 'completed':
    case 'complete':
      return { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300', label: 'Completed' };
    case 'on_hold':
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: 'On Hold' };
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', label: status };
  }
}

/**
 * Progress bar component
 */
function ProgressBar({ value }: { value: number }) {
  const percent = Math.min(Math.max(value, 0), 100);
  const color = percent >= 80 ? 'bg-green-500' :
                percent >= 50 ? 'bg-blue-500' :
                percent >= 25 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-300`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-xs text-[var(--ff-text-secondary)] w-8 text-right">
        {percent}%
      </span>
    </div>
  );
}

export function RecentProjectsTable({ projects, isLoading = false }: RecentProjectsTableProps) {
  if (isLoading) {
    return (
      <div className="ff-card">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ff-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] tracking-wide">
          Recent Projects
        </h3>
        <Link
          href="/projects?tab=all"
          className="text-xs text-[var(--ff-primary)] hover:underline flex items-center gap-1"
        >
          View All
          <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm text-[var(--ff-text-secondary)]">
            No projects found
          </p>
          <Link
            href="/projects/new"
            className="inline-block mt-2 text-sm text-[var(--ff-primary)] hover:underline"
          >
            Create your first project
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)]">
                <th className="ff-table-th text-left py-2 px-3">Project</th>
                <th className="ff-table-th text-left py-2 px-3 hidden md:table-cell">Client</th>
                <th className="ff-table-th text-left py-2 px-3">Status</th>
                <th className="ff-table-th text-left py-2 px-3 hidden sm:table-cell w-32">Progress</th>
                <th className="ff-table-th text-left py-2 px-3 hidden lg:table-cell">Manager</th>
                <th className="ff-table-th py-2 px-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const statusBadge = getStatusBadge(project.status);

                return (
                  <tr
                    key={project.id}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-secondary)] transition-colors"
                  >
                    <td className="py-3 px-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="font-medium text-[var(--ff-text-primary)] hover:text-[var(--ff-primary)] transition-colors"
                      >
                        {project.project_name}
                      </Link>
                    </td>
                    <td className="py-3 px-3 hidden md:table-cell text-sm text-[var(--ff-text-secondary)]">
                      {project.client_name || '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusBadge.bg} ${statusBadge.text}`}>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td className="py-3 px-3 hidden sm:table-cell">
                      <ProgressBar value={project.progress} />
                    </td>
                    <td className="py-3 px-3 hidden lg:table-cell text-sm text-[var(--ff-text-secondary)]">
                      {project.manager_name || '—'}
                    </td>
                    <td className="py-3 px-3">
                      <Link
                        href={`/projects/${project.id}`}
                        className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-primary)]"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RecentProjectsTable;
