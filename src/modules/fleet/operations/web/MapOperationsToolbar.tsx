import type { OperationalMapOverlay } from '../mapOverlayService';
import type { OperationalProjectOption } from '../projectScope';
import type { OperationalStatusGroup } from '../presentationTypes';
import type { OperationalStatus } from '../types';
import type { FleetMapLayerState } from './useFleetMapLayers';
import type { LiveFleetTelemetry } from './operationsPresentationApi';
import {
  type OperationEvidenceFilter,
  type OperationFilters,
  type OperationVisibilityFilter,
} from './operationFilters';
import { isCurrentOperationDate } from './useOperationalOverview';

const GROUPS: Array<[OperationalStatusGroup, string]> = [
  ['on_site', 'On site'], ['approaching', 'Approaching'], ['late', 'Late'],
  ['wrong_site', 'Wrong site'], ['mismatch', 'Mismatch'], ['left_early', 'Left early'],
  ['unassigned', 'Unassigned'], ['unverifiable', 'Unverifiable'], ['normal', 'Normal'],
];
const STATUSES: Array<[OperationalStatus, string]> = [
  ['off_duty', 'Off duty'], ['scheduled_not_due', 'Scheduled, not due'],
  ['late', 'Late'], ['wrong_site', 'Wrong site'], ['evidence_mismatch', 'Evidence mismatch'],
  ['left_early', 'Left early'], ['unassigned', 'Unassigned'], ['unverifiable', 'Unverifiable'],
  ['vehicle_on_site_driver_unconfirmed', 'Vehicle on site — driver unconfirmed'],
  ['attendance_confirmed', 'Attendance confirmed'], ['on_site_dual', 'On site dual'],
  ['approaching', 'Approaching'], ['shift_complete', 'Shift complete'],
];
const EVIDENCE: Array<[OperationEvidenceFilter, string]> = [
  ['attendance_only', 'Attendance only'], ['vehicle_only', 'Vehicle only'], ['dual', 'Dual evidence'],
  ['missing', 'Missing evidence'], ['stale', 'Stale vehicle evidence'],
];
const VISIBILITY: Array<[OperationVisibilityFilter, string]> = [
  ['all', 'All markers'], ['vehicles', 'Vehicles only'], ['drivers', 'Drivers only'],
];

function sastDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function datedFilters(filters: OperationFilters, workDate: string): OperationFilters {
  const asOf = isCurrentOperationDate(workDate)
    ? new Date().toISOString() : new Date(`${workDate}T23:59:59.999+02:00`).toISOString();
  return { ...filters, workDate, asOf };
}

function displayTime(value: string): string {
  return new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
}

function LayerStatus({ label, layer }: {
  label: string;
  layer: FleetMapLayerState<LiveFleetTelemetry> | FleetMapLayerState<OperationalMapOverlay>;
}) {
  return <span>{label} updated {layer.lastSuccessAt
    ? <time dateTime={layer.lastSuccessAt}>{displayTime(layer.lastSuccessAt)}</time> : 'not yet'}</span>;
}

export interface MapOperationsToolbarProps {
  filters: OperationFilters;
  projects: OperationalProjectOption[];
  telemetry: FleetMapLayerState<LiveFleetTelemetry>;
  overlay: FleetMapLayerState<OperationalMapOverlay>;
  onChange: (filters: OperationFilters) => void;
  projectOptionsError?: boolean;
}

export function MapOperationsToolbar({
  filters, projects, telemetry, overlay, onChange, projectOptionsError = false,
}: MapOperationsToolbarProps) {
  const statusValue = filters.status ? `status:${filters.status}` : filters.group ? `group:${filters.group}` : '';
  const changeStatus = (value: string) => {
    const next: OperationFilters = { ...filters, status: undefined, group: undefined };
    if (value.startsWith('status:')) next.status = value.slice(7) as OperationalStatus;
    if (value.startsWith('group:')) next.group = value.slice(6) as OperationalStatusGroup;
    onChange(next);
  };
  const current = isCurrentOperationDate(filters.workDate);
  return (
    <div className="mt-2 space-y-2" aria-label="Map operations controls">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>Project<select aria-label="Map project" value={filters.projectId ?? ''}
          onChange={(event) => onChange({ ...filters, projectId: event.target.value || undefined, staffId: undefined, siteId: undefined })}
          className="ml-1 rounded border px-2 py-1"><option value="">Select project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}</select></label>
        <label>Status<select aria-label="Map status" value={statusValue} onChange={(event) => changeStatus(event.target.value)}
          className="ml-1 rounded border px-2 py-1"><option value="">All statuses</option>
          <optgroup label="Groups">{GROUPS.map(([value, label]) => <option key={value} value={`group:${value}`}>{label}</option>)}</optgroup>
          <optgroup label="Primary statuses">{STATUSES.map(([value, label]) => <option key={value} value={`status:${value}`}>{label}</option>)}</optgroup>
        </select></label>
        <label>Evidence<select aria-label="Map evidence" value={filters.evidence ?? ''}
          onChange={(event) => onChange({ ...filters, evidence: event.target.value as OperationEvidenceFilter || undefined })}
          className="ml-1 rounded border px-2 py-1"><option value="">All evidence</option>
          {EVIDENCE.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Visibility<select aria-label="Map visibility" value={filters.visibility ?? 'all'}
          onChange={(event) => onChange({ ...filters, visibility: event.target.value as OperationVisibilityFilter })}
          className="ml-1 rounded border px-2 py-1">{VISIBILITY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Date<input aria-label="Map date" type="date" max={sastDate()} value={filters.workDate ?? ''}
          onChange={(event) => { if (event.target.value) onChange(datedFilters(filters, event.target.value)); }}
          className="ml-1 rounded border px-2 py-1" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        <strong className={current ? '' : 'text-amber-700'}>{current ? 'Current view' : 'Historical view'}</strong>
        {!current && filters.asOf && <span>Evaluated <time dateTime={filters.asOf}>{displayTime(filters.asOf)}</time></span>}
        <LayerStatus label="Vehicles" layer={telemetry} /><LayerStatus label="Operations" layer={overlay} />
        <button type="button" onClick={() => void telemetry.refresh()} className="rounded border px-2 py-1">Refresh vehicles</button>
        <button type="button" onClick={() => void overlay.refresh()} className="rounded border px-2 py-1">Refresh operations</button>
      </div>
      {telemetry.error && <p role="alert" className="text-xs text-red-600">{telemetry.data
        ? 'Live vehicle refresh failed; showing last successful positions.' : 'Live vehicle positions could not be refreshed.'}</p>}
      {overlay.error && <p role="alert" className="text-xs text-red-600">{overlay.error.kind === 'permission'
        ? 'Operational overlay is unavailable for this account.' : overlay.data
          ? 'Operational overlay refresh failed; showing last successful data.' : 'Operational overlay could not be refreshed.'}</p>}
      {projectOptionsError && <p role="alert" className="text-xs text-red-600">
        Project options could not be refreshed.
      </p>}
    </div>
  );
}
