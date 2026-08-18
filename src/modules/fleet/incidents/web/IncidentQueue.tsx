/**
 * Filters, loading/error/empty states, and queue composition (Task 8).
 * `/fleet/incidents` is a workflow queue inside the existing Operations
 * navigation, not a new dashboard — this component owns nothing about the
 * Fleet shell itself (`pages/fleet/incidents.tsx` supplies that). Filters
 * are URL-backed via `window.history.replaceState` (mirrors
 * `operations/web/TodayOperations.tsx`'s `locationFilters`/`replaceLocation`
 * pair) so a Dashboard/Map deep link or a page reload reproduces the same
 * queue, and so a background poll never resets the address bar or the open
 * drawer.
 */
import { useCallback, useState } from 'react';
import { INCIDENT_TYPES, SEVERITIES } from '../reviewValidation';
import type { IncidentLifecycleStatus } from '../types';
import {
  hasActiveIncidentFilters, incidentApi, IncidentApiError, parseIncidentQueueFilters,
  serializeIncidentQueueFilters, useIncidentQueue, type IncidentQueueFilters,
} from './incidentApi';
import { IncidentReviewDrawer } from './IncidentReviewDrawer';
import { IncidentSettingsDialog } from './IncidentSettingsDialog';
import { IncidentTable } from './IncidentTable';

const LIFECYCLE_STATUSES: readonly IncidentLifecycleStatus[] = ['open', 'acknowledged', 'under_review', 'resolved', 'dismissed'];
const PAGE_LIMIT = 25;

const SELECT_FILTERS: ReadonlyArray<{ key: keyof IncidentQueueFilters; label: string; options: readonly string[] }> = [
  { key: 'lifecycleStatus', label: 'Status', options: LIFECYCLE_STATUSES },
  { key: 'incidentType', label: 'Type', options: INCIDENT_TYPES },
  { key: 'severity', label: 'Severity', options: SEVERITIES },
  { key: 'conditionState', label: 'Condition', options: ['active', 'cleared'] },
  { key: 'evidenceState', label: 'Evidence', options: ['required', 'present'] },
];
const TEXT_FILTERS: ReadonlyArray<{ key: keyof IncidentQueueFilters; label: string; type: 'text' | 'date' }> = [
  { key: 'projectId', label: 'Project ID', type: 'text' }, { key: 'managerUserId', label: 'Manager user ID', type: 'text' },
  { key: 'staffId', label: 'Staff ID', type: 'text' }, { key: 'fromDate', label: 'From date', type: 'date' },
  { key: 'toDate', label: 'To date', type: 'date' },
];

function locationFilters(): IncidentQueueFilters {
  return typeof window === 'undefined' ? {} : parseIncidentQueueFilters(window.location.search);
}
function replaceLocation(filters: IncidentQueueFilters): void {
  if (typeof window === 'undefined') return;
  const query = serializeIncidentQueueFilters(filters);
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

function FilterBar({ filters, onChange }: { filters: IncidentQueueFilters; onChange: (next: IncidentQueueFilters) => void }) {
  return (
    <div role="group" aria-label="Incident filters" className="flex flex-wrap items-end gap-3">
      {SELECT_FILTERS.map((field) => (
        <label key={field.key} className="text-sm text-[var(--ff-text-secondary)]">{field.label}
          <select aria-label={field.label} value={(filters[field.key] as string | undefined) ?? ''}
            onChange={(event) => onChange({ ...filters, [field.key]: event.target.value || undefined })} className="ml-2 rounded border px-2 py-2">
            <option value="">Any</option>
            {field.options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
          </select>
        </label>
      ))}
      {TEXT_FILTERS.map((field) => (
        <label key={field.key} className="text-sm text-[var(--ff-text-secondary)]">{field.label}
          <input aria-label={field.label} type={field.type} value={(filters[field.key] as string | undefined) ?? ''}
            onChange={(event) => onChange({ ...filters, [field.key]: event.target.value || undefined })} className="ml-2 rounded border px-2 py-2" />
        </label>
      ))}
      <label className="text-sm text-[var(--ff-text-secondary)]">
        <input aria-label="Overdue only" type="checkbox" checked={filters.overdueOnly === true}
          onChange={(event) => onChange({ ...filters, overdueOnly: event.target.checked || undefined })} /> Overdue only
      </label>
    </div>
  );
}

export interface IncidentQueueProps { canEdit: boolean; canManageSettings: boolean }

export function IncidentQueue({ canEdit, canManageSettings }: IncidentQueueProps) {
  const [filters, setFilters] = useState<IncidentQueueFilters>(locationFilters);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const { data, error, loading, refresh } = useIncidentQueue(filters, page, PAGE_LIMIT);

  const change = useCallback((next: IncidentQueueFilters) => { setFilters(next); setPage(1); setSelected(new Set()); replaceLocation(next); }, []);
  const toggleSelect = (id: string) => setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const openIncident = (id: string) => { setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null); setOpenIncidentId(id); };

  async function bulkAcknowledge(): Promise<void> {
    if (!selected.size) return;
    setBulkSubmitting(true); setBulkError(null);
    try { await incidentApi.bulkAcknowledge([...selected]); setSelected(new Set()); await refresh(); }
    catch (caught) { setBulkError(caught instanceof IncidentApiError ? caught.message : 'Could not acknowledge the selected incidents'); }
    finally { setBulkSubmitting(false); }
  }

  if (error?.kind === 'permission') {
    return <section aria-label="Fleet incidents" className="rounded-lg border p-5"><p role="alert">You do not have permission to view Fleet incidents.</p></section>;
  }

  return (
    <section aria-label="Fleet incidents" className="space-y-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] p-5">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Fleet incidents</h2>
        {canManageSettings && <button type="button" onClick={() => setSettingsOpen(true)} className="rounded border px-3 py-2 text-sm">Settings</button>}
      </header>
      <FilterBar filters={filters} onChange={change} />
      {error && <p role="alert" className="text-sm text-red-700">Fleet incidents could not be refreshed{data ? ' — showing the last successful data.' : '.'}</p>}
      {loading && !data && <p>Loading Fleet incidents…</p>}
      {data && data.total === 0 && !hasActiveIncidentFilters(filters) && <p>No Fleet incidents right now.</p>}
      {data && data.total === 0 && hasActiveIncidentFilters(filters) && <p>No incidents match the current filters.</p>}
      {data && data.total > 0 && <>
        {canEdit && <div className="flex items-center gap-3">
          <button type="button" disabled={!selected.size || bulkSubmitting} onClick={() => void bulkAcknowledge()} className="rounded border px-3 py-2 text-sm disabled:opacity-50">
            {bulkSubmitting ? 'Acknowledging…' : `Acknowledge selected (${selected.size})`}
          </button>
          {bulkError && <p role="alert" className="text-sm text-red-700">{bulkError}</p>}
        </div>}
        <IncidentTable incidents={data.incidents} canEdit={canEdit} selected={selected} onToggleSelect={toggleSelect} onOpen={openIncident} />
        <div className="flex items-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-2 disabled:opacity-50">Previous</button>
          <span>Page {page} of {Math.max(1, Math.ceil(data.total / PAGE_LIMIT))}</span>
          <button type="button" disabled={page * PAGE_LIMIT >= data.total} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-2 disabled:opacity-50">Next</button>
        </div>
      </>}
      {openIncidentId && <IncidentReviewDrawer incidentId={openIncidentId} canEdit={canEdit} returnFocus={opener}
        onClose={() => setOpenIncidentId(null)} onChanged={() => void refresh()} />}
      {canManageSettings && <IncidentSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} canEdit={canManageSettings} />}
    </section>
  );
}
