import { useCallback, useEffect, useRef, useState } from 'react';
import type { OperationalProjectOption } from '../projectScope';
import type { OperationalAttentionRow, OperationalStatusGroup } from '../presentationTypes';
import { AttentionList } from './AttentionList';
import { OperationalEvidenceDrawer } from './OperationalEvidenceDrawer';
import { parseOperationFilters, serializeOperationFilters, type OperationFilters } from './operationFilters';
import { OperationsPresentationApiError, operationsPresentationApi } from './operationsPresentationApi';
import { StatusCountBar } from './StatusCountBar';
import { isCurrentOperationDate, useOperationalOverview } from './useOperationalOverview';

const FILTER_KEYS: Array<keyof OperationFilters> = [
  'projectId', 'staffId', 'siteId', 'workDate', 'asOf', 'status', 'group', 'evidence',
];

function sastDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function datedFilters(filters: OperationFilters, workDate: string, now = new Date()): OperationFilters {
  const asOf = isCurrentOperationDate(workDate, now)
    ? now.toISOString() : new Date(`${workDate}T23:59:59.999+02:00`).toISOString();
  return { ...filters, workDate, asOf };
}

function locationFilters(now = new Date()): OperationFilters {
  const source = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  const known = new URLSearchParams();
  for (const key of FILTER_KEYS) for (const value of source.getAll(key)) known.append(key, value);
  try {
    const parsed = parseOperationFilters(known);
    return datedFilters(parsed, parsed.workDate ?? sastDate(now), now);
  } catch {
    return datedFilters({}, sastDate(now), now);
  }
}

function replaceLocation(filters: OperationFilters, replace: boolean): void {
  const query = serializeOperationFilters(filters);
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', next);
}

interface OperationsPanelProps {
  filters: OperationFilters;
  projects: OperationalProjectOption[];
  onChange: (filters: OperationFilters) => void;
}

function OperationsPanel({ filters, projects, onChange }: OperationsPanelProps) {
  const { data, error, refresh } = useOperationalOverview(filters);
  const [selected, setSelected] = useState<OperationalAttentionRow | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  if (error?.kind === 'permission') return null;
  const evidenceFilters = data ? { ...filters, workDate: data.workDate, asOf: data.evaluatedAt } : filters;
  const selectGroup = (group: OperationalStatusGroup | undefined) => {
    const next = { ...filters, group }; delete next.status; onChange(next);
  };
  return (
    <section role="region" aria-labelledby="today-operations-title"
      className="rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] shadow">
      <div className="flex flex-col gap-4 border-b border-[var(--ff-border-light)] p-5 lg:flex-row lg:items-end lg:justify-between">
        <div><h2 id="today-operations-title" className="text-lg font-semibold text-[var(--ff-text-primary)]">Today&apos;s Operations</h2>
          {data && <p className="text-xs text-[var(--ff-text-tertiary)]">Last evaluated <time dateTime={data.evaluatedAt}>{new Date(data.evaluatedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</time><span className="sr-only"> · Rule version {data.rule.version ?? 'unavailable'}</span></p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!isCurrentOperationDate(filters.workDate) && <span className="text-xs font-medium text-amber-700">Historical view</span>}
          <label className="text-sm text-[var(--ff-text-secondary)]">Project
            <select aria-label="Operations project" value={filters.projectId ?? ''}
              onChange={(event) => onChange({ ...filters, projectId: event.target.value || undefined })}
              className="ml-2 rounded border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] px-2 py-2">
              {projects.map((project) => <option key={project.id} value={project.id}>{project.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-[var(--ff-text-secondary)]">Date
            <input aria-label="Operations date" type="date" max={sastDate()} value={filters.workDate ?? ''}
              onChange={(event) => onChange(datedFilters(filters, event.target.value))}
              className="ml-2 rounded border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] px-2 py-2" />
          </label>
          <button type="button" aria-label="Refresh operations" onClick={() => void refresh()}
            className="rounded border border-[var(--ff-border-light)] px-3 py-2 text-sm">Refresh</button>
        </div>
      </div>
      <div className="space-y-5 p-5">
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {data ? 'Showing the last successful operational data; refresh failed.' : 'Operational data could not be refreshed.'}
        </p>}
        {!data && !error && <p className="text-sm text-[var(--ff-text-secondary)]">Loading operational data…</p>}
        {data && <><div><h3 className="mb-2 font-medium text-[var(--ff-text-primary)]">Morning Roll Call</h3>
          <StatusCountBar groups={data.groups} selected={filters.group} onSelect={selectGroup} /></div>
          <div><h3 className="mb-2 font-medium text-[var(--ff-text-primary)]">Needs Attention</h3>
            {data.selectionState === 'no_scheduled_staff' && <p>No staff are scheduled for this selection.</p>}
            {data.selectionState === 'no_attention' && <p>No operational items need attention.</p>}
            {data.selectionState === 'attention_available' && <>
              {data.attention.hasMore && <p className="mb-2 text-xs font-medium text-amber-700">
                Showing {data.attention.items.length} of {data.attention.total} — {data.attention.total - data.attention.items.length} more not shown. Narrow the filters to see the rest.
              </p>}
              <AttentionList rows={data.attention.items} filters={evidenceFilters}
                onOpenEvidence={(row, target) => { setSelected(row); setOpener(target); }} />
            </>}
          </div></>}
      </div>
      {selected && <OperationalEvidenceDrawer row={selected} filters={evidenceFilters} returnFocus={opener}
        onClose={() => setSelected(null)} />}
    </section>
  );
}

export function TodayOperations() {
  const [filters, setFilters] = useState<OperationFilters>(locationFilters);
  const currentFilters = useRef(filters);
  const [projects, setProjects] = useState<OperationalProjectOption[]>([]);
  const [optionsState, setOptionsState] = useState<'loading' | 'ready' | 'error' | 'permission'>('loading');
  const change = useCallback((next: OperationFilters, replace = false) => {
    currentFilters.current = next; replaceLocation(next, replace); setFilters(next);
  }, []);

  useEffect(() => {
    replaceLocation(currentFilters.current, true);
    const navigate = () => {
      const next = locationFilters(); currentFilters.current = next; replaceLocation(next, true); setFilters(next);
    };
    window.addEventListener('popstate', navigate);
    return () => window.removeEventListener('popstate', navigate);
  }, []);

  useEffect(() => {
    let active = true; setOptionsState('loading');
    const controller = new AbortController();
    void operationsPresentationApi.projectOptions(controller.signal).then((options) => {
      if (!active) return;
      setProjects(options); setOptionsState('ready');
      const current = currentFilters.current;
      const projectId = options.some((item) => item.id === current.projectId)
        ? current.projectId : options[0]?.id;
      if (projectId !== current.projectId) change({ ...current, projectId }, true);
    }).catch((caught: unknown) => {
      if (!active) return;
      const permission = caught instanceof OperationsPresentationApiError && caught.kind === 'permission';
      if (permission) setProjects([]);
      setOptionsState(permission ? 'permission' : 'error');
    });
    return () => { active = false; controller.abort(); };
  }, [change]);

  if (optionsState === 'permission') return null;
  if (optionsState === 'loading') return <section aria-label="Today's Operations" className="rounded-lg border p-5">Loading Today&apos;s Operations…</section>;
  if (optionsState === 'error') return <section aria-label="Today's Operations" className="rounded-lg border p-5"><h2>Today&apos;s Operations</h2><p role="alert">Operational data could not be refreshed.</p></section>;
  if (!filters.projectId || !projects.length) return <section aria-label="Today's Operations" className="rounded-lg border p-5"><h2>Today&apos;s Operations</h2><p>No authorized operational projects are available.</p></section>;
  return <OperationsPanel filters={filters} projects={projects} onChange={change} />;
}
