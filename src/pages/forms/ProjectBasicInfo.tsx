/**
 * Project Basic Information Form Section
 */

import { ProjectFormData } from '@/types/project.types';

interface ProjectBasicInfoProps {
  formData: ProjectFormData;
  onInputChange: (field: keyof ProjectFormData, value: any) => void;
}

export function ProjectBasicInfo({ formData, onInputChange }: ProjectBasicInfoProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Project Information</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Project Code *
            </label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => onInputChange('code', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., LAW-001"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Project Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => onInputChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Lawley Fiber Installation"
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => onInputChange('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Brief description of the project scope and objectives..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Location *
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => onInputChange('location', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Lawley, Johannesburg"
              required
            />
          </div>
        </div>
      </div>
    </div>
  );
}