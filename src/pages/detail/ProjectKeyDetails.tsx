/**
 * Project Key Details Component
 * Sidebar showing key project information
 */

import { Calendar, DollarSign, Clock, Users } from 'lucide-react';
import { Project } from '@/types/project.types';
import { formatDate, formatCurrency } from './ProjectDetailUtils';

interface ProjectKeyDetailsProps {
  project: Project;
}

export function ProjectKeyDetails({ project }: ProjectKeyDetailsProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Key Details</h2>

      <div className="space-y-4">
        <div className="flex items-center">
          <Calendar className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">Start Date</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{formatDate(project.startDate)}</p>
          </div>
        </div>

        <div className="flex items-center">
          <Calendar className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">Expected End</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{formatDate(project.endDate)}</p>
          </div>
        </div>

        <div className="flex items-center">
          <DollarSign className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">Budget</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">{formatCurrency(project.budget || 0)}</p>
          </div>
        </div>

        <div className="flex items-center">
          <Clock className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
          <div>
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">Working Hours</p>
            <p className="text-sm text-[var(--ff-text-secondary)]">N/A</p>
          </div>
        </div>

        {project.projectManager && (
          <div className="flex items-center">
            <Users className="h-5 w-5 text-[var(--ff-text-tertiary)] mr-3" />
            <div>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">Project Manager</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">{project.projectManager}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}