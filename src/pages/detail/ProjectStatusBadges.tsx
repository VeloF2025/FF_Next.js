/**
 * Project Status Badges Component
 * Displays status, priority, and type badges
 */

import { Project } from '@/types/project.types';
import { statusColors, priorityColors } from './ProjectDetailHelpers';
import { formatStatus, formatPriority, formatProjectType } from './ProjectDetailUtils';

interface ProjectStatusBadgesProps {
  project: Project;
}

export function ProjectStatusBadges({ project }: ProjectStatusBadgesProps) {
  const fallbackColors = 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)]';

  return (
    <div className="flex items-center gap-4">
      <span
        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
          statusColors[project.status] || fallbackColors
        }`}
      >
        {formatStatus(project.status)}
      </span>

      <span
        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
          priorityColors[project.priority] || fallbackColors
        }`}
      >
        {formatPriority(project.priority)}
      </span>

      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${fallbackColors}`}>
        {formatProjectType(project.projectType)}
      </span>
    </div>
  );
}