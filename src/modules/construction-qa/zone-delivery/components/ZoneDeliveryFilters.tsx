import type { ChangeEvent } from 'react';
import type { ZoneDeliveryStatus, ZoneRegisterFilters } from '../types/zoneDelivery.types';

interface ProjectOption {
  id: string;
  name: string;
}

interface ZoneDeliveryFiltersProps {
  filters: ZoneRegisterFilters;
  projects: ProjectOption[];
  onChange: (filters: ZoneRegisterFilters) => void;
}

const statusOptions: Array<{ value: ZoneDeliveryStatus; label: string }> = [
  { value: 'handed_over', label: 'Handed over' },
  { value: 'scope_pending', label: 'Scope pending' },
  { value: 'handover_blocked', label: 'Handover blocked' },
  { value: 'zone_qa_in_progress', label: 'Zone QA in progress' },
  { value: 'ready_for_zone_qa', label: 'Ready for Zone QA' },
  { value: 'go_live_in_progress', label: 'Go-live in progress' },
  { value: 'awaiting_port_approval', label: 'Awaiting port approval' },
  { value: 'ready_for_port_submission', label: 'Ready for port submission' },
  { value: 'testing_in_progress', label: 'Testing in progress' },
  { value: 'optical_construction', label: 'Optical construction' },
  { value: 'civil_construction', label: 'Civil construction' },
];

const fieldClass = 'w-full rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--ff-text-primary)]';

export function ZoneDeliveryFilters({ filters, projects, onChange }: ZoneDeliveryFiltersProps) {
  const setFilter = <K extends keyof ZoneRegisterFilters>(key: K, value: ZoneRegisterFilters[K]) => {
    onChange({ ...filters, [key]: value || undefined });
  };
  const setZoneNo = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setFilter('zoneNo', Number.isInteger(value) && value > 0 ? value : undefined);
  };

  return (
    <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-4 md:grid-cols-2 xl:grid-cols-7">
      <legend className="sr-only">Zone delivery filters</legend>
      <label className="text-sm text-[var(--ff-text-secondary)]">Project
        <select aria-label="Project" className={fieldClass} value={filters.projectId ?? ''} onChange={event => setFilter('projectId', event.target.value)}>
          <option value="">All projects</option>
          {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className="text-sm text-[var(--ff-text-secondary)]">Zone number
        <input aria-label="Zone number" className={fieldClass} min="1" type="number" value={filters.zoneNo ?? ''} onChange={setZoneNo} />
      </label>
      <label className="text-sm text-[var(--ff-text-secondary)]">Status
        <select aria-label="Status" className={fieldClass} value={filters.status ?? ''} onChange={event => setFilter('status', event.target.value as ZoneDeliveryStatus)}>
          <option value="">All statuses</option>
          {statusOptions.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
      </label>
      <label className="text-sm text-[var(--ff-text-secondary)]">Blocker
        <input aria-label="Blocker" className={fieldClass} value={filters.blocker ?? ''} onChange={event => setFilter('blocker', event.target.value)} />
      </label>
      <label className="text-sm text-[var(--ff-text-secondary)]">Handover
        <select aria-label="Handover" className={fieldClass} value={filters.handover ?? ''} onChange={event => setFilter('handover', event.target.value as ZoneRegisterFilters['handover'])}>
          <option value="">All handovers</option><option value="pending">Pending</option><option value="complete">Complete</option>
        </select>
      </label>
      <label className="text-sm text-[var(--ff-text-secondary)]">Search
        <input aria-label="Search" className={fieldClass} value={filters.search ?? ''} onChange={event => setFilter('search', event.target.value)} />
      </label>
      <button type="button" className="self-end rounded-md border border-[var(--border-color)] px-3 py-2 text-sm text-[var(--ff-text-primary)] hover:bg-[var(--hover-bg)]" onClick={() => onChange({})}>
        Clear filters
      </button>
    </fieldset>
  );
}
