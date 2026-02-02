/**
 * Project Quick Stats Component
 * Sidebar showing quick project statistics
 */

import { Project } from '@/types/project.types';
import { formatCurrency } from './ProjectDetailUtils';

interface ProjectQuickStatsProps {
  project: Project;
}

/**
 * Derive workflow phase from project status
 */
function getPhaseFromStatus(status: string | undefined): string {
  const normalizedStatus = (status || '').toLowerCase().trim();

  switch (normalizedStatus) {
    case 'pipeline':
    case 'prospect':
    case 'qualifying':
      return 'Pipeline';
    case 'planned':
    case 'planning':
      return 'Planning';
    case 'active':
    case 'in_progress':
    case 'in progress':
    case 'execution':
      return 'Execution';
    case 'completed':
    case 'closed':
    case 'closure':
      return 'Closure';
    case 'on_hold':
    case 'on hold':
      return 'On Hold';
    default:
      return 'Planning';
  }
}

export function ProjectQuickStats({ project }: ProjectQuickStatsProps) {
  // Use explicit phase if set, otherwise derive from status
  const currentPhase = project.phase || getPhaseFromStatus(project.status);

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

        <div className="flex justify-between">
          <span className="text-sm text-[var(--ff-text-secondary)]">Current Phase</span>
          <span className="text-sm font-medium text-[var(--ff-text-primary)]">
            {currentPhase}
          </span>
        </div>
      </div>
    </div>
  );
}