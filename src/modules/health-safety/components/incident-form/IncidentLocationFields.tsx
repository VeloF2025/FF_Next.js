/**
 * Incident Location Fields - Location text, project, contractor, GPS
 */

import { MapPin } from 'lucide-react';

/** Slim project option for incident location form dropdown */
interface ProjectOption {
  id: number;
  project_name: string;
}

interface Contractor {
  id: number;
  company_name: string;
}

interface IncidentLocationFieldsProps {
  location: string;
  projectId: string;
  contractorId: string;
  projects: ProjectOption[];
  contractors: Contractor[];
  onChange: (field: string, value: string) => void;
}

const inputClass =
  'w-full px-4 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--ff-primary-500)]';
const labelClass = 'block text-sm font-medium text-[var(--ff-text-primary)] mb-1';

export function IncidentLocationFields({
  location,
  projectId,
  contractorId,
  projects,
  contractors,
  onChange,
}: IncidentLocationFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-[var(--ff-text-secondary)] uppercase tracking-wider">
        Location & Context
      </h3>

      {/* Project & Contractor */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="project_id" className={labelClass}>
            Project
          </label>
          <select
            id="project_id"
            value={projectId}
            onChange={(e) => onChange('project_id', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select project —</option>
            {projects.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.project_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="contractor_id" className={labelClass}>
            Contractor
          </label>
          <select
            id="contractor_id"
            value={contractorId}
            onChange={(e) => onChange('contractor_id', e.target.value)}
            className={inputClass}
          >
            <option value="">— Select contractor —</option>
            {contractors.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.company_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Location */}
      <div>
        <label htmlFor="location" className={labelClass}>
          Location Description
        </label>
        <div className="relative">
          <MapPin aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ff-text-tertiary)]" />
          <input
            type="text"
            id="location"
            value={location}
            onChange={(e) => onChange('location', e.target.value)}
            placeholder="Where did the incident occur? (e.g., Site A, Pole 42, Corner of Main & Oak)"
            className={`${inputClass} pl-10`}
          />
        </div>
      </div>
    </div>
  );
}
