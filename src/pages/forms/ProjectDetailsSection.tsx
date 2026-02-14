/**
 * Project Details Form Section
 */

import { ProjectFormData, ProjectType, ProjectStatus, Priority } from '@/types/project.types';

interface ProjectDetailsSectionProps {
  formData: ProjectFormData;
  onInputChange: (field: keyof ProjectFormData, value: any) => void;
}

export function ProjectDetailsSection({ formData, onInputChange }: ProjectDetailsSectionProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="p-6 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Project Details</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Project Type *
            </label>
            <select
              value={formData.projectType}
              onChange={(e) => onInputChange('projectType', e.target.value as ProjectType)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              {Object.values(ProjectType).map(type => (
                <option key={type} value={type}>
                  {type.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Priority Level *
            </label>
            <select
              value={formData.priority}
              onChange={(e) => onInputChange('priority', e.target.value as Priority)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              {Object.values(Priority).map(priority => (
                <option key={priority} value={priority}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Status *
            </label>
            <select
              value={formData.status}
              onChange={(e) => onInputChange('status', e.target.value as ProjectStatus)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              {Object.values(ProjectStatus).map(status => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}