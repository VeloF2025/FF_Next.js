import type { DeliveryTreeFilters } from '../useDeliveryTree';

interface ProjectOption {
  id: string;
  name: string;
}

interface DeliveryTreeFilterProps {
  filters: DeliveryTreeFilters;
  projects: ProjectOption[];
  onChange: (filters: DeliveryTreeFilters) => void;
}

const fieldClass = 'w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--ff-text-primary)]';

export function DeliveryTreeFilter({ filters, projects, onChange }: DeliveryTreeFilterProps) {
  return (
    <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:grid-cols-3">
      <legend className="sr-only">Delivery tree filters</legend>
      <label className="text-sm text-[var(--ff-text-secondary)]">Project
        <select
          aria-label="Project"
          className={fieldClass}
          value={filters.projectId}
          onChange={event => onChange({ ...filters, projectId: event.target.value })}
        >
          <option value="">All projects</option>
          {projects.map(project => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 self-end text-sm text-[var(--ff-text-primary)]">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[var(--border-color)]"
          checked={filters.opticalSubmittedOnly}
          onChange={event => onChange({ ...filters, opticalSubmittedOnly: event.target.checked })}
        />
        Optical Submitted only
      </label>
      <button
        type="button"
        className="self-end justify-self-start rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--hover-bg)]"
        onClick={() => onChange({ projectId: '', opticalSubmittedOnly: false })}
      >
        Clear filters
      </button>
    </fieldset>
  );
}
