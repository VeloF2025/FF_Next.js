/**
 * Project Quick Stats Component
 * Sidebar showing quick project statistics
 */

import { Project } from '@/types/project.types';
import { formatCurrency } from './ProjectDetailUtils';

interface ProjectQuickStatsProps {
  project: Project;
}

export function ProjectQuickStats({ project }: ProjectQuickStatsProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Quick Stats</h2>

      <div className="space-y-3">
        <div className="flex justify-between">
          <span className="text-sm text-[var(--ff-text-secondary)]">Budget Used</span>
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {formatCurrency(project.actualCost || 0)}
          </span>
        </div>

        {project.actualCost && (
          <div className="flex justify-between">
            <span className="text-sm text-[var(--ff-text-secondary)]">Actual Cost</span>
            <span className="text-sm font-medium text-[var(--ff-text-primary)]">
              {formatCurrency(project.actualCost)}
            </span>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-sm text-[var(--ff-text-secondary)]">Current Phase</span>
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {project.phase || 'Planning'}
          </span>
        </div>
      </div>
    </div>
  );
}