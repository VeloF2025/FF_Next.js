/**
 * Project Information Card Component
 */

import { MapPin, Building2 } from 'lucide-react';
import { Project } from '@/types/project.types';

interface ProjectInfoCardProps {
  project: Project;
}

export function ProjectInfoCard({ project }: ProjectInfoCardProps) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg shadow-sm border border-[var(--ff-border-light)] p-6">
      <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Project Information</h2>

      <div className="space-y-4">
        {project.description && (
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Description</h3>
            <p className="text-[var(--ff-text-primary)]">{project.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Location</h3>
            <div className="flex items-center text-[var(--ff-text-primary)]">
              <MapPin className="h-4 w-4 mr-2" />
              {project.location}
            </div>
          </div>

          {project.clientName && (
            <div>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Client</h3>
              <div className="flex items-center text-[var(--ff-text-primary)]">
                <Building2 className="h-4 w-4 mr-2" />
                {project.clientName}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}