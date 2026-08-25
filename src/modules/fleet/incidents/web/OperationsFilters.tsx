/**
 * The `op_` filter bar (stage 8, task 9).
 *
 * Independent of the vehicle scorecard's own period and type controls, which
 * are component state on the page and never reach the URL. These do reach it,
 * under their `op_` names, so a deep link into one filter set cannot silently
 * pre-filter the other.
 *
 * Seven of the eleven filters get a control. `op_manager`, `op_site` and
 * `op_vehicle` are deep-link only — they are honoured, serialized and exported
 * like any other, they simply have no picker yet.
 */
import { INCIDENT_TYPES, OUTCOMES, SEVERITIES } from '../reviewValidation';
import { INCIDENT_TYPE_LABELS, OUTCOME_LABELS, SEVERITY_LABELS } from './incidentLabels';
import { IncidentIdFilter } from './IncidentIdFilter';
import { incidentApi } from './incidentApi';
import type { OperationsFilters as Filters } from '../analytics/types';

export interface OperationsFiltersProps {
  filters: Filters;
  onChange: (filters: Filters) => void;
}

/** Sets one optional filter, clearing it when the control returns to "any". */
function withOptional(filters: Filters, field: keyof Filters, value: string | undefined): Filters {
  const next = { ...filters };
  if (value === undefined || value === '') delete next[field];
  else Object.assign(next, { [field]: value });
  return next;
}

function Select({ id, label, value, options, onPick }: {
  id: string; label: string; value: string | undefined;
  options: readonly { value: string; label: string }[];
  onPick: (value: string | undefined) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-[var(--ff-text-secondary)] mb-1">{label}</label>
      <select
        id={id} data-testid={id} value={value ?? ''}
        onChange={(event) => onPick(event.target.value === '' ? undefined : event.target.value)}
        className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm"
      >
        <option value="">Any</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}

function DateField({ id, label, value, onPick }: {
  id: string; label: string; value: string; onPick: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-[var(--ff-text-secondary)] mb-1">{label}</label>
      <input
        id={id} data-testid={id} type="date" value={value}
        onChange={(event) => onPick(event.target.value)}
        className="px-3 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm"
      />
    </div>
  );
}

export function OperationsFilters({ filters, onChange }: OperationsFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <DateField
        id="operations-filter-start" label="From" value={filters.start}
        onPick={(start) => onChange({ ...filters, start })}
      />
      <DateField
        id="operations-filter-end" label="To" value={filters.end}
        onPick={(end) => onChange({ ...filters, end })}
      />
      <div>
        <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Project</label>
        <IncidentIdFilter
          label="" value={filters.projectId}
          onChange={(projectId) => onChange(withOptional(filters, 'projectId', projectId))}
          search={incidentApi.searchProjects} resolveById={incidentApi.resolveProject}
        />
      </div>
      <div>
        <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Driver</label>
        <IncidentIdFilter
          label="" value={filters.staffId}
          onChange={(staffId) => onChange(withOptional(filters, 'staffId', staffId))}
          search={incidentApi.searchStaff} resolveById={incidentApi.resolveStaffMember}
        />
      </div>
      <Select
        id="operations-filter-type" label="Type" value={filters.incidentType}
        options={INCIDENT_TYPES.map((type) => ({ value: type, label: INCIDENT_TYPE_LABELS[type] }))}
        onPick={(value) => onChange(withOptional(filters, 'incidentType', value))}
      />
      <Select
        id="operations-filter-severity" label="Severity" value={filters.severity}
        options={SEVERITIES.map((severity) => ({ value: severity, label: SEVERITY_LABELS[severity] }))}
        onPick={(value) => onChange(withOptional(filters, 'severity', value))}
      />
      <Select
        id="operations-filter-outcome" label="Outcome" value={filters.outcome}
        options={OUTCOMES.map((outcome) => ({ value: outcome, label: OUTCOME_LABELS[outcome] }))}
        onPick={(value) => onChange(withOptional(filters, 'outcome', value))}
      />
      <Select
        id="operations-filter-evidence" label="Evidence"
        value={filters.evidenceAvailable === undefined ? undefined : String(filters.evidenceAvailable)}
        options={[{ value: 'true', label: 'Evidence attached' }, { value: 'false', label: 'No evidence' }]}
        onPick={(value) => {
          const next = { ...filters };
          if (value === undefined) delete next.evidenceAvailable;
          else next.evidenceAvailable = value === 'true';
          onChange(next);
        }}
      />
    </div>
  );
}
