/**
 * Project Filters Component
 * Advanced filtering interface for projects
 */

import { ProjectFiltersProps } from '../types';
import { ProjectStatus, ProjectType, Priority } from '@/types/project.types';

export function ProjectFilters({
  filter,
  onUpdateFilter,
  onClearFilter,
  showFilters,
  onToggleFilters: _onToggleFilters
}: ProjectFiltersProps) {
  if (!showFilters) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Filters</h3>
        <button
          onClick={onClearFilter}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Clear All
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Status</label>
          <select
            multiple
            value={filter.status || []}
            onChange={(e) => onUpdateFilter({ 
              status: Array.from(e.target.selectedOptions, option => option.value) as ProjectStatus[]
            })}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(ProjectStatus).map(status => (
              <option key={status} value={status}>
                {status ? status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ') : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Type Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Project Type</label>
          <select
            multiple
            value={filter.projectType || []}
            onChange={(e) => onUpdateFilter({ 
              projectType: Array.from(e.target.selectedOptions, option => option.value) as ProjectType[]
            })}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(ProjectType).map(type => (
              <option key={type} value={type}>
                {type.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Priority Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Priority</label>
          <select
            multiple
            value={filter.priority || []}
            onChange={(e) => onUpdateFilter({ 
              priority: Array.from(e.target.selectedOptions, option => option.value) as Priority[]
            })}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.values(Priority).map(priority => (
              <option key={priority} value={priority}>
                {priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}