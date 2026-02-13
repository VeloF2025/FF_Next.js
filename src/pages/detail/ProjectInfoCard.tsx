/**
 * Project Information Card Component
 */

import { MapPin, Building2 } from 'lucide-react';
import { Project } from '@/types/project.types';

interface ProjectInfoCardProps {
  project: Project;
}

function formatLocation(location: unknown): string {
  if (!location) return 'Not specified';
  const loc = typeof location === 'string' ? location : String(location);

  // Try parsing as JSON (handles {"coordinates":...,"city":"Lawley",...} format)
  try {
    const parsed = JSON.parse(loc);
    const parts: string[] = [];
    if (parsed.city) parts.push(parsed.city);
    if (parsed.region) parts.push(parsed.region);
    if (parsed.province) parts.push(parsed.province);
    if (parsed.country) parts.push(parsed.country);
    if (parts.length > 0) return parts.join(', ');
    // If JSON but no readable fields, check address
    if (parsed.address) return parsed.address;
    // All fields empty — show placeholder instead of raw JSON
    return 'Not specified';
  } catch {
    // Not JSON — return as-is (plain text location)
    return loc;
  }
}

export function ProjectInfoCard({ project }: ProjectInfoCardProps) {
  const displayLocation = formatLocation(project.location);

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
              <MapPin className="h-4 w-4 mr-2 flex-shrink-0" />
              {displayLocation}
            </div>
          </div>

          {project.clientName && (
            <div>
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Client</h3>
              <div className="flex items-center text-[var(--ff-text-primary)]">
                <Building2 className="h-4 w-4 mr-2 flex-shrink-0" />
                {project.clientName}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}