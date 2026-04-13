/**
 * Project Schedule & Budget Form Section
 */

import { ProjectFormData } from '@/types/project.types';
import { StaffDropdownOption } from '@/types/staff.types';

interface ProjectScheduleBudgetProps {
  formData: ProjectFormData;
  onInputChange: (field: keyof ProjectFormData, value: ProjectFormData[keyof ProjectFormData]) => void;
  managers: StaffDropdownOption[];
  isManagersLoading: boolean;
}

export function ProjectScheduleBudget({ 
  formData, 
  onInputChange, 
  managers, 
  isManagersLoading 
}: ProjectScheduleBudgetProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border">
      <div className="p-6 border-b border-border">
        <h2 className="text-lg font-semibold text-foreground">Schedule & Budget</h2>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Start Date *
            </label>
            <input
              type="date"
              value={formData.startDate.split('T')[0]}
              onChange={(e) => onInputChange('startDate', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Expected End Date *
            </label>
            <input
              type="date"
              value={formData.endDate.split('T')[0]}
              onChange={(e) => onInputChange('endDate', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Budget (ZAR)
            </label>
            <input
              type="number"
              value={formData.budget}
              onChange={(e) => onInputChange('budget', parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-muted-foreground mb-2">
              Project Manager *
            </label>
            <select
              value={formData.projectManagerId}
              onChange={(e) => onInputChange('projectManagerId', e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
              disabled={isManagersLoading}
            >
              <option value="">
                {isManagersLoading ? 'Loading managers...' : 'Select a project manager'}
              </option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} - {manager.position}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Assign a project manager to oversee this project
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}